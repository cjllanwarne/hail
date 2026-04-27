import argparse
import asyncio
import json
import logging
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncContextManager, Dict, List, Optional, Tuple

from rich.progress import Progress, TaskID

from .. import uvloopx
from ..utils.rich_progress_bar import CopyToolProgressBar, make_listener
from ..utils.utils import sleep_before_try
from . import Copier, Transfer
from .router_fs import RouterAsyncFS


class GrowingSempahore(AsyncContextManager[asyncio.Semaphore]):
    def __init__(self, start_max: int, target_max: int, progress_and_tid: Optional[Tuple[Progress, TaskID]]):
        self.task: Optional[asyncio.Task] = None
        self.target_max = target_max
        self.current_max = start_max
        self.sema = asyncio.Semaphore(self.current_max)
        self.progress_and_tid = progress_and_tid

    async def _grow(self):
        growths = 0
        while self.current_max < self.target_max:
            await sleep_before_try(
                growths,
                base_delay_ms=15_000,
                max_delay_ms=5 * 60_000,
            )
            new_max = min(int(self.current_max * 1.5), self.target_max)
            diff = new_max - self.current_max
            self.sema._value += diff
            self.sema._wake_up_next()
            self.current_max = new_max
            if self.progress_and_tid:
                progress, tid = self.progress_and_tid
                progress.update(tid, advance=diff)

    async def __aenter__(self) -> asyncio.Semaphore:
        self.task = asyncio.create_task(self._grow())
        await self.sema.__aenter__()
        return self.sema

    async def __aexit__(self, exc_type, exc, tb):
        try:
            await self.sema.__aexit__(exc_type, exc, tb)
        finally:
            if self.task is not None:
                if self.task.done() and not self.task.cancelled():
                    if exc := self.task.exception():
                        raise exc
                else:
                    self.task.cancel()


async def copy(
    *,
    max_simultaneous_transfers: Optional[int] = None,
    local_kwargs: Optional[dict] = None,
    gcs_kwargs: Optional[dict] = None,
    azure_kwargs: Optional[dict] = None,
    s3_kwargs: Optional[dict] = None,
    transfers: List[Transfer],
    verbose: bool = False,
) -> None:
    with ThreadPoolExecutor() as thread_pool:
        if max_simultaneous_transfers is None:
            max_simultaneous_transfers = 75
        if local_kwargs is None:
            local_kwargs = {}
        if 'thread_pool' not in local_kwargs:
            local_kwargs['thread_pool'] = thread_pool

        if s3_kwargs is None:
            s3_kwargs = {}
        if 'thread_pool' not in s3_kwargs:
            s3_kwargs['thread_pool'] = thread_pool
        if 'max_pool_connections' not in s3_kwargs:
            s3_kwargs['max_pool_connections'] = max_simultaneous_transfers * 2

        async with RouterAsyncFS(
            local_kwargs=local_kwargs, gcs_kwargs=gcs_kwargs, azure_kwargs=azure_kwargs, s3_kwargs=s3_kwargs
        ) as fs:
            with CopyToolProgressBar(transient=True, disable=not verbose) as progress:
                initial_simultaneous_transfers = 10
                parallelism_tid = progress.add_task(
                    description='parallelism',
                    completed=initial_simultaneous_transfers,
                    total=max_simultaneous_transfers,
                    visible=verbose,
                )
                async with GrowingSempahore(
                    initial_simultaneous_transfers, max_simultaneous_transfers, (progress, parallelism_tid)
                ) as sema:
                    file_tid = progress.add_task(description='files', total=0, visible=verbose)
                    bytes_tid = progress.add_task(description='bytes', total=0, visible=verbose)
                    copy_report = await Copier.copy(
                        fs,
                        sema,
                        transfers,
                        files_listener=make_listener(progress, file_tid),
                        bytes_listener=make_listener(progress, bytes_tid),
                    )
                if verbose:
                    copy_report.summarize()


def deduce_staging_directory(group_files: List[Dict[str, str]]) -> str:
    dest_dirs = [os.path.dirname(os.path.abspath(f['to'])) for f in group_files]
    return os.path.commonpath(dest_dirs)


def _build_gcloud_transfer_groups(eligible: List[Dict[str, str]]) -> List[Tuple[str, List[Dict[str, str]]]]:
    """
    Partition eligible files into (staging_dir, transfer_group) pairs such that
    within each transfer_group no two files share a GCS object basename.

    Files are assigned round-robin by GCS basename into collision-free groups.
    The staging directory for each group is the commonpath of all destination
    directories in that group, ensuring staging stays on the same filesystem as
    every final destination (making renames free inode operations).
    """
    transfer_groups: List[Dict] = []  # [{'basenames': set, 'files': list}]
    for f in eligible:
        basename = f['from'].rstrip('/').split('/')[-1]
        placed = False
        for tg in transfer_groups:
            if basename not in tg['basenames']:
                tg['basenames'].add(basename)
                tg['files'].append(f)
                placed = True
                break
        if not placed:
            transfer_groups.append({'basenames': {basename}, 'files': [f]})

    result: List[Tuple[str, List[Dict[str, str]]]] = []
    for tg in transfer_groups:
        files = tg['files']
        result.append((deduce_staging_directory(files), files))

    return result


async def gcloud_localize(
    files: List[Dict[str, str]],
    requester_pays_project: Optional[str],
    verbose: bool,
) -> List[Dict[str, str]]:
    """
    Fast-path for GCS→local copies using `gcloud storage cp`.

    Eligible transfers (GCS source, local 'to' destination — files or directories)
    are partitioned into collision-free transfer groups where no two sources share
    a GCS basename.  Each group is downloaded in a single `gcloud storage cp -r`
    call staged under the commonpath of all destinations, then renamed to final
    paths as free same-filesystem inode operations.

    Returns the subset of `files` not handled here for the caller to pass to
    the Copier fallback.
    """
    eligible: List[Dict[str, str]] = []
    fallback: List[Dict[str, str]] = []
    for f in files:
        src = f.get('from', '')
        if 'to' in f and src.startswith('gs://') and '://' not in f['to']:
            eligible.append(f)
        else:
            fallback.append(f)

    if not eligible:
        return fallback

    transfer_groups = _build_gcloud_transfer_groups(eligible)

    for i, (staging_dir, group_files) in enumerate(transfer_groups):
        os.makedirs(staging_dir, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=staging_dir) as staging_tmp:
            gcloud_cmd = ['gcloud', 'storage', 'cp', '-r']
            if not verbose:
                gcloud_cmd.append('-q')
            if isinstance(requester_pays_project, str):
                gcloud_cmd += ['--billing-project', requester_pays_project]
            gcloud_cmd += [f['from'].rstrip('/') for f in group_files]
            gcloud_cmd.append(staging_tmp + '/')

            if verbose:
                logging.info(
                    'gcloud localize transfer_group %d/%d (%d files): %s',
                    i + 1,
                    len(transfer_groups),
                    len(group_files),
                    ' '.join(gcloud_cmd),
                )

            try:
                proc = await asyncio.create_subprocess_exec(
                    *gcloud_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _stdout, stderr = await proc.communicate()
            except FileNotFoundError:
                logging.warning('gcloud not found; falling back to Copier for all remaining GCS transfers')
                for _, remaining in transfer_groups[i:]:
                    fallback.extend(remaining)
                return fallback

            if proc.returncode != 0:
                logging.warning(
                    'gcloud storage cp failed (rc=%d), falling back to Copier for transfer_group:\n%s',
                    proc.returncode,
                    stderr.decode(),
                )
                fallback.extend(group_files)
                continue

            for f in group_files:
                src = f['from']
                dest = f['to']
                basename = src.rstrip('/').split('/')[-1]
                staged = os.path.join(staging_tmp, basename)
                if src.endswith('/'):
                    os.rename(staged, dest.rstrip('/'))
                else:
                    dest_dir = os.path.dirname(dest)
                    if dest_dir:
                        os.makedirs(dest_dir, exist_ok=True)
                    os.rename(staged, dest)

    return fallback


def make_transfer(json_object: Dict[str, str]) -> Transfer:
    if 'to' in json_object:
        return Transfer(json_object['from'], json_object['to'], treat_dest_as=Transfer.DEST_IS_TARGET)
    assert 'into' in json_object
    return Transfer(json_object['from'], json_object['into'], treat_dest_as=Transfer.DEST_DIR)


async def copy_from_dict(
    *,
    max_simultaneous_transfers: Optional[int] = None,
    local_kwargs: Optional[dict] = None,
    gcs_kwargs: Optional[dict] = None,
    azure_kwargs: Optional[dict] = None,
    s3_kwargs: Optional[dict] = None,
    files: List[Dict[str, str]],
    verbose: bool = False,
) -> None:
    requester_pays_project = (gcs_kwargs or {}).get('gcs_requester_pays_configuration')
    files = await gcloud_localize(files, requester_pays_project, verbose)
    if not files:
        return
    transfers = [make_transfer(json_object) for json_object in files]
    await copy(
        max_simultaneous_transfers=max_simultaneous_transfers,
        local_kwargs=local_kwargs,
        gcs_kwargs=gcs_kwargs,
        azure_kwargs=azure_kwargs,
        s3_kwargs=s3_kwargs,
        transfers=transfers,
        verbose=verbose,
    )


async def main() -> None:
    parser = argparse.ArgumentParser(description='Hail copy tool')
    parser.add_argument(
        'requester_pays_project',
        type=str,
        help='a JSON string indicating the Google project to which to charge egress costs',
    )
    parser.add_argument(
        'files',
        type=str,
        nargs='?',
        help='a JSON array of JSON objects indicating from where and to where to copy files. If empty or "-", read the array from standard input instead',
    )
    parser.add_argument(
        '--max-simultaneous-transfers',
        type=int,
        help='The limit on the number of simultaneous transfers. Large files are uploaded as multiple transfers. This parameter sets an upper bound on the number of open source and destination files.',
    )
    parser.add_argument(
        '-v', '--verbose', action='store_const', const=True, default=False, help='show logging information'
    )
    parser.add_argument('--timeout', type=str, default=None, help='show logging information')
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig()
        logging.root.setLevel(logging.INFO)

        # Add disk availability log before starting copy operations
        try:
            df_result = subprocess.run(['df', '-h'], capture_output=True, text=True, check=True)
            logging.info("=== Disk availability before copy operations ===")
            logging.info(df_result.stdout)
            logging.info("=== End disk availability ===")
        except subprocess.CalledProcessError as e:
            logging.error(f"Failed to get disk usage: {e}")
        except FileNotFoundError:
            logging.error("df command not found")

    requester_pays_project = json.loads(args.requester_pays_project)
    if args.files is None or args.files == '-':
        args.files = sys.stdin.read()
    files = json.loads(args.files)

    if args.verbose:
        logging.info("=== Files to copy ===")
        logging.info(files)
        logging.info("=== End files to copy ===")

    timeout = args.timeout
    if timeout:
        timeout = float(timeout)
    gcs_kwargs = {
        'gcs_requester_pays_configuration': requester_pays_project,
        'timeout': timeout,
    }
    azure_kwargs = {
        'timeout': timeout,
    }
    s3_kwargs = {
        'timeout': timeout,
    }

    await copy_from_dict(
        max_simultaneous_transfers=args.max_simultaneous_transfers,
        gcs_kwargs=gcs_kwargs,
        azure_kwargs=azure_kwargs,
        s3_kwargs=s3_kwargs,
        files=files,
        verbose=args.verbose,
    )


if __name__ == '__main__':
    uvloopx.install()
    asyncio.run(main())
