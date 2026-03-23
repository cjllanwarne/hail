import asyncio
import errno
import io
import logging
import os
import shutil
import struct
from typing import Optional, Tuple

import numpy as np
import pandas as pd

from hailtop.aiotools.fs import AsyncFS
from hailtop.utils import check_shell_output, sleep_before_try, time_msecs, time_ns

log = logging.getLogger('resource_usage')


iptables_lock = asyncio.Lock()


class ResourceUsageMonitor:
    VERSION = 3
    missing_value = None

    @staticmethod
    def no_data() -> bytes:
        return ResourceUsageMonitor.version_to_bytes()

    @staticmethod
    def version_to_bytes() -> bytes:
        return struct.pack('>q', ResourceUsageMonitor.VERSION)

    @staticmethod
    def decode_to_df(data: bytes) -> Optional[pd.DataFrame]:
        try:
            return ResourceUsageMonitor._decode_to_df(data)
        except Exception:
            log.exception('corrupt resource usage file found', stack_info=True)
            return None

    @staticmethod
    def _decode_to_df(data: bytes) -> Optional[pd.DataFrame]:
        if len(data) == 0:
            return None

        (version,) = struct.unpack_from('>q', data, 0)
        assert 1 <= version <= ResourceUsageMonitor.VERSION, version

        dtype = [
            ('time_msecs', '>i8'),
            ('memory_in_bytes', '>i8'),
            ('cpu_usage', '>f8'),
        ]

        if version >= 2:
            dtype += [
                ('non_io_storage_in_bytes', '>i8'),
                ('io_storage_in_bytes', '>i8'),
                ('network_bandwidth_upload_in_bytes_per_second', '>f8'),
                ('network_bandwidth_download_in_bytes_per_second', '>f8'),
            ]
        if version >= 3:
            dtype += [
                ('network_bandwidth_cloud_internal_upload_in_bytes_per_second', '>f8'),
                ('network_bandwidth_cloud_internal_download_in_bytes_per_second', '>f8'),
            ]
        np_array = np.frombuffer(data, offset=8, dtype=dtype)

        return pd.DataFrame.from_records(np_array)

    def __init__(
        self,
        container_name: str,
        container_overlay: str,
        io_volume_mount: Optional[str],
        veth_host: str,
        cloud_internal_dl_chain: str,
        cloud_internal_ul_chain: str,
        output_file_path: str,
        fs: AsyncFS,
    ):
        assert veth_host is not None

        self.container_name = container_name
        self.container_overlay = container_overlay
        self.io_volume_mount = io_volume_mount
        self.veth_host = veth_host
        self.cloud_internal_dl_chain = cloud_internal_dl_chain
        self.cloud_internal_ul_chain = cloud_internal_ul_chain
        self.output_file_path = output_file_path
        self.fs = fs

        self.is_attached_disk = io_volume_mount is not None and os.path.ismount(io_volume_mount)

        self.last_time_ns: Optional[int] = None
        self.last_cpu_ns: Optional[int] = None

        self.last_download_bytes: Optional[int] = None
        self.last_upload_bytes: Optional[int] = None
        self.last_time_msecs: Optional[int] = None
        self.last_cloud_internal_download_bytes: Optional[int] = None
        self.last_cloud_internal_upload_bytes: Optional[int] = None

        self.out: Optional[io.BufferedWriter] = None

        self.task: Optional[asyncio.Future] = None

    def write_header(self):
        assert self.out
        data = self.version_to_bytes()
        self.out.write(data)
        self.out.flush()

    def cpu_ns(self) -> Optional[int]:
        # See below for a nice breakdown of the cpu cgroupv2:
        # https://facebookmicrosites.github.io/cgroup2/docs/cpu-controller.html#interface-files
        #
        # and here for the authoritative source:
        # https://git.kernel.org/pub/scm/linux/kernel/git/tj/cgroup.git/tree/Documentation/admin-guide/cgroup-v2.rst#n1038
        usage_file = f'/sys/fs/cgroup/{self.container_name}/cpu.stat'
        try:
            with open(usage_file, 'r', encoding='utf-8') as f:
                for line in f.readlines():
                    stat, val = line.strip().split(' ')
                    if stat == 'usage_usec':
                        return int(val) * 1000
                return None
        except FileNotFoundError:
            return None
        except OSError as e:
            # OSError: [Errno 19] No such device
            if e.errno == 19:
                return None
            raise

    def percent_cpu_usage(self) -> Optional[float]:
        now_time_ns = time_ns()
        now_cpu_ns = self.cpu_ns()

        if now_cpu_ns is None or self.last_cpu_ns is None or self.last_time_ns is None:
            cpu_usage = None
        else:
            cpu_usage = (now_cpu_ns - self.last_cpu_ns) / (now_time_ns - self.last_time_ns)

        self.last_time_ns = now_time_ns
        self.last_cpu_ns = now_cpu_ns
        return cpu_usage

    def memory_usage_bytes(self) -> Optional[int]:
        # See below for a nice breakdown of the memory cgroupv2:
        # https://facebookmicrosites.github.io/cgroup2/docs/memory-controller.html#core-interface-files
        #
        # and here for the authoritative source:
        # https://git.kernel.org/pub/scm/linux/kernel/git/tj/cgroup.git/tree/Documentation/admin-guide/cgroup-v2.rst#n1156
        usage_file = f'/sys/fs/cgroup/{self.container_name}/memory.current'
        try:
            with open(usage_file, 'r', encoding='utf-8') as f:
                return int(f.read().rstrip())
        except FileNotFoundError:
            return None
        except OSError as e:
            # OSError: [Errno 19] No such device
            if e.errno == 19:
                return None
            raise

    def overlay_storage_usage_bytes(self) -> int:
        return shutil.disk_usage(self.container_overlay).used

    def io_storage_usage_bytes(self) -> int:
        if self.io_volume_mount is not None:
            return shutil.disk_usage(self.io_volume_mount).used
        return 0

    async def network_bandwidth(self) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
        async with iptables_lock:
            now_time_msecs = time_msecs()

            iptables_output, stderr = await check_shell_output(f"""
iptables -t mangle -L -v -n -x -w | grep "{self.veth_host}" | awk '{{ if ($6 == "{self.veth_host}" && $8 == "0.0.0.0/0") print "ul", $2; if ($7 == "{self.veth_host}" && $9 == "0.0.0.0/0") print "dl", $2 }}'
""")
            if stderr:
                log.exception(stderr)
                return (None, None, None, None)

            ci_dl_output, ci_dl_stderr = await check_shell_output(
                f'iptables -t mangle -L {self.cloud_internal_dl_chain} -v -n -x -w | awk \'NR==3 {{print $2}}\''
            )
            if ci_dl_stderr:
                log.exception(ci_dl_stderr)
                return (None, None, None, None)

            ci_ul_output, ci_ul_stderr = await check_shell_output(
                f'iptables -t mangle -L {self.cloud_internal_ul_chain} -v -n -x -w | awk \'NR==3 {{print $2}}\''
            )
            if ci_ul_stderr:
                log.exception(ci_ul_stderr)
                return (None, None, None, None)

        output = iptables_output.decode('utf-8').rstrip().splitlines()
        assert len(output) == 2, str((output, self.veth_host))

        now_upload_bytes = None
        now_download_bytes = None
        for line in output:
            fields = line.split()
            direction = fields[0]
            bytes_transmitted = int(fields[1])
            if direction == 'ul':
                now_upload_bytes = bytes_transmitted
            else:
                assert direction == 'dl', line
                now_download_bytes = bytes_transmitted

        assert now_upload_bytes is not None and now_download_bytes is not None, output

        now_cloud_internal_download_bytes = int(ci_dl_output.decode('utf-8').strip())
        now_cloud_internal_upload_bytes = int(ci_ul_output.decode('utf-8').strip())

        if (
            self.last_upload_bytes is None
            or self.last_download_bytes is None
            or self.last_cloud_internal_download_bytes is None
            or self.last_cloud_internal_upload_bytes is None
            or self.last_time_msecs is None
        ):
            self.last_time_msecs = time_msecs()
            self.last_upload_bytes = now_upload_bytes
            self.last_download_bytes = now_download_bytes
            self.last_cloud_internal_download_bytes = now_cloud_internal_download_bytes
            self.last_cloud_internal_upload_bytes = now_cloud_internal_upload_bytes
            return (None, None, None, None)

        elapsed_msecs = now_time_msecs - self.last_time_msecs
        upload_bandwidth = (now_upload_bytes - self.last_upload_bytes) / elapsed_msecs
        download_bandwidth = (now_download_bytes - self.last_download_bytes) / elapsed_msecs
        cloud_internal_download_bandwidth = (
            now_cloud_internal_download_bytes - self.last_cloud_internal_download_bytes
        ) / elapsed_msecs
        cloud_internal_upload_bandwidth = (
            now_cloud_internal_upload_bytes - self.last_cloud_internal_upload_bytes
        ) / elapsed_msecs

        to_mb_sec = 1000 / 1024 / 1024
        upload_bandwidth_mb_sec = upload_bandwidth * to_mb_sec
        download_bandwidth_mb_sec = download_bandwidth * to_mb_sec
        cloud_internal_download_bandwidth_mb_sec = cloud_internal_download_bandwidth * to_mb_sec
        cloud_internal_upload_bandwidth_mb_sec = cloud_internal_upload_bandwidth * to_mb_sec

        self.last_time_msecs = now_time_msecs
        self.last_upload_bytes = now_upload_bytes
        self.last_download_bytes = now_download_bytes
        self.last_cloud_internal_download_bytes = now_cloud_internal_download_bytes
        self.last_cloud_internal_upload_bytes = now_cloud_internal_upload_bytes

        return (
            upload_bandwidth_mb_sec,
            download_bandwidth_mb_sec,
            cloud_internal_upload_bandwidth_mb_sec,
            cloud_internal_download_bandwidth_mb_sec,
        )

    async def measure(self):
        now = time_msecs()
        memory_usage_bytes = self.memory_usage_bytes()
        percent_cpu_usage = self.percent_cpu_usage()

        if memory_usage_bytes is None or percent_cpu_usage is None:
            return

        overlay_usage_bytes = self.overlay_storage_usage_bytes()
        io_usage_bytes = self.io_storage_usage_bytes()
        non_io_usage_bytes = overlay_usage_bytes if self.is_attached_disk else overlay_usage_bytes - io_usage_bytes
        upload, download, cloud_internal_upload, cloud_internal_download = await self.network_bandwidth()

        if upload is None:
            return

        data = struct.pack(
            '>2qd2q4d',
            now,
            memory_usage_bytes,
            percent_cpu_usage,
            non_io_usage_bytes,
            io_usage_bytes,
            upload,
            download,
            cloud_internal_upload,
            cloud_internal_download,
        )

        assert self.out
        self.out.write(data)
        self.out.flush()

    async def read(self):
        if os.path.exists(self.output_file_path):
            return await self.fs.read(self.output_file_path)
        return ResourceUsageMonitor.no_data()

    async def __aenter__(self):
        async def periodically_measure():
            start = time_msecs()
            cancelled = False
            tries = 0
            while True:
                try:
                    await self.measure()
                except asyncio.CancelledError:
                    cancelled = True
                    raise
                except OSError as err:
                    if err.errno == errno.ENOSPC:
                        cancelled = True
                        raise
                    log.exception(f'while monitoring {self.container_name}')
                except Exception:
                    log.exception(f'while monitoring {self.container_name}')
                finally:
                    if not cancelled:
                        tries += 1
                        if time_msecs() - start < 5_000:
                            await asyncio.sleep(0.1)
                        else:
                            await sleep_before_try(tries, max_delay_ms=5_000)

        os.makedirs(os.path.dirname(self.output_file_path), exist_ok=True)
        self.out = open(self.output_file_path, 'wb')  # pylint: disable=consider-using-with
        self.write_header()

        self.task = asyncio.ensure_future(periodically_measure())
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.task is not None:
            self.task.cancel()
            self.task = None

        if self.out is not None:
            self.out.close()
            self.out = None
