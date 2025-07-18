.. _sec-change-log:

Python Version Compatibility Policy
===================================

Hail complies with `NumPy's compatibility policy <https://numpy.org/neps/nep-0029-deprecation_policy.html#implementation>`__ on Python
versions. In particular, Hail officially supports:

- All minor versions of Python released 42 months prior to the project, and at minimum the two
  latest minor versions.

- All minor versions of numpy released in the 24 months prior to the project, and at minimum the
  last three minor versions.

Change Log
==========

**Version 0.2.135**

- (`#14927 <https://github.com/hail-is/hail/pull/14927>`__)
  Worker image and derived docker images upgraded to ubuntu 24.04.
- (`#14925 <https://github.com/hail-is/hail/pull/14925>`__)
  UI filtering improvements to user table
- (`#14916 <https://github.com/hail-is/hail/pull/14916>`__)
  Improved logging around JVM initialization failures
- (`#14880 <https://github.com/hail-is/hail/pull/14880>`__)
  Truncate job names when used as a directory name under /io
- (`#14919 <https://github.com/hail-is/hail/pull/14919>`__)
  Fixes a bug that made workers seem unresponsive and prevented jobs from
  being marked complete.
- (`#14912 <https://github.com/hail-is/hail/pull/14912>`__)
  hailctl batch init now creates buckets in the default region with a 7 day
  lifecycle policy instead of 30 day.
- (`#14895 <https://github.com/hail-is/hail/pull/14895>`__)
  Add support for multiple configuration profiles
- (`#14848 <https://github.com/hail-is/hail/pull/14848>`__)
  Use the default region when a user doesn't specify a region
- (`#14908 <https://github.com/hail-is/hail/pull/14908>`__)
  Adds default_region API endpoint
- (`#14901 <https://github.com/hail-is/hail/pull/14901>`__)
  Fixes bug where remove_tmpdir jobs were not run in the regions the user
  specified.
- (`#14810 <https://github.com/hail-is/hail/pull/14810>`__)
  Adds SESSION_MAX_AGE_SECS to configure session timeout duration
- (`#14849 <https://github.com/hail-is/hail/pull/14849>`__)
  Temporary buckets are initialized with soft delete disabled.
- (`#14876 <https://github.com/hail-is/hail/pull/14876>`__)
  Batch progress bar now displays accrued cost
- (`#14878 <https://github.com/hail-is/hail/pull/14878>`__)'
  Login UI requires ToS acceptance.
- (`#14844 <https://github.com/hail-is/hail/pull/14844>`__)
  Adds support for n1 machines with T4 GPUs in GCP
- (`#14833 <https://github.com/hail-is/hail/pull/14833>`__)
  Various openapi documentation additions and fixes.
- (`#14841 <https://github.com/hail-is/hail/pull/14841>`__)
  Fixed a regression preventing hyphens in usernames.

**Version 0.2.132**

- (`#14576 <https://github.com/hail-is/hail/pull/14576>`__) Fixed bug where
  submitting many Python jobs would fail with `RecursionError`.

**Version 0.2.131**

- (`#14544 <https://github.com/hail-is/hail/pull/14544>`__) `batch.read_input`
  and `batch.read_input_group` now accept `os.PathLike` objects as well as strings.
- (`#14328 <https://github.com/hail-is/hail/pull/14328>`__) Job resource usage
  data can now be retrieved from the Batch API.

**Version 0.2.130**

- (`#14425 <https://github.com/hail-is/hail/pull/14425>`__) A job's 'always run'
  state is rendered in the Job and Batch pages. This makes it easier to understand
  why a job is queued to run when others have failed or been cancelled.
- (`#14437 <https://github.com/hail-is/hail/pull/14437>`__) The billing page now
  reports users' spend on the batch service.

**Version 0.2.128**

- (`#14224 <https://github.com/hail-is/hail/pull/14224>`__) `hb.Batch` now accepts a
  `default_regions` argument which is the default for all jobs in the Batch.

**Version 0.2.124**

- (`#13681 <https://github.com/hail-is/hail/pull/13681>`__) Fix `hailctl batch init` and `hailctl auth login` for
  new users who have never set up a configuration before.

**Version 0.2.123**

- (`#13643 <https://github.com/hail-is/hail/pull/13643>`__) Python jobs in Hail Batch that use the default image now support
  all supported python versions and include the hail python package.
- (`#13614 <https://github.com/hail-is/hail/pull/13614>`__) Fixed a bug that broke the `LocalBackend` when run inside a
  Jupyter notebook.
- (`#13200 <https://github.com/hail-is/hail/pull/13200>`__) `hailtop.batch` will now raise an error by default if a pipeline
  attempts to read or write files from or two cold storage buckets in GCP.

**Version 0.2.122**

- (`#13565 <https://github.com/hail-is/hail/pull/13565>`__) Users can now use VEP images from the `hailgenetics` DockerHub
  in Hail Batch.

**Version 0.2.121**

- (`#13396 <https://github.com/hail-is/hail/pull/13396>`__) Non-spot instances can be requested via the :meth:`.Job.spot` method.

**Version 0.2.117**

- (`#13007 <https://github.com/hail-is/hail/pull/13007>`__) Memory and storage request strings may now be optionally terminated with a `B` for bytes.
- (`#13051 <https://github.com/hail-is/hail/pull/13051>`__) Azure Blob Storage `https` URLs are now supported.

**Version 0.2.115**

- (`#12731 <https://github.com/hail-is/hail/pull/12731>`__) Introduced `hailtop.fs` that makes public a filesystem module that works for local fs, gs, s3 and abs. This can be used by `import hailtop.fs as hfs`.
- (`#12918 <https://github.com/hail-is/hail/pull/12918>`__) Fixed a combinatorial explosion in cancellation calculation in the :class:`.LocalBackend`
- (`#12917 <https://github.com/hail-is/hail/pull/12917>`__) ABS blob URIs in the form of `https://<ACCOUNT_NAME>.blob.core.windows.net/<CONTAINER_NAME>/<PATH>` are now supported when running in Azure. The `hail-az` scheme for referencing ABS blobs is now deprecated and will be removed in a future release.

**Version 0.2.114**

- (`#12780 <https://github.com/hail-is/hail/pull/12881>`__) PythonJobs now handle arguments with resources nested inside dicts and lists.
- (`#12900 <https://github.com/hail-is/hail/pull/12900>`__) Reading data from public blobs is now supported in Azure.

**Version 0.2.113**

- (`#12780 <https://github.com/hail-is/hail/pull/12780>`__) The LocalBackend now supports `always_run` jobs. The LocalBackend will no longer immediately error when a job fails, rather now aligns with the ServiceBackend in running all jobs whose parents have succeeded.
- (`#12845 <https://github.com/hail-is/hail/pull/12845>`__) The LocalBackend now sets the working directory for dockerized jobs to the root directory instead of the temp directory. This behavior now matches ServiceBackend jobs.

**Version 0.2.111**

- (`#12530 <https://github.com/hail-is/hail/pull/12530>`__) Added the ability to update an existing batch with additional jobs by calling :meth:`.Batch.run` more than once. The method :meth:`.Batch.from_batch_id`
  can be used to construct a :class:`.Batch` from a previously submitted batch.

**Version 0.2.110**

- (`#12734 <https://github.com/hail-is/hail/pull/12734>`__) :meth:`.PythonJob.call` now immediately errors when supplied arguments are incompatible with the called function instead of erroring only when the job is run.
- (`#12726 <https://github.com/hail-is/hail/pull/12726>`__) :class:`.PythonJob` now supports intermediate file resources the same as :class:`.BashJob`.
- (`#12684 <https://github.com/hail-is/hail/pull/12684>`__) :class:`.PythonJob` now correctly uses the default region when a specific region for the job is not given.

**Version 0.2.103**

- Added a new method Job.regions() as well as a configurable parameter to the ServiceBackend to
  specify which cloud regions a job can run in. The default value is a job can run in any available region.

**Version 0.2.89**

- Support passing an authorization token to the ``ServiceBackend``.

**Version 0.2.79**

- The `bucket` parameter in the ``ServiceBackend`` has been deprecated. Use `remote_tmpdir` instead.

**Version 0.2.75**

- Fixed a bug introduced in 0.2.74 where large commands were not interpolated correctly
- Made resource files be represented as an explicit path in the command rather than using environment
  variables
- Fixed ``Backend.close`` to be idempotent
- Fixed ``BatchPoolExecutor`` to always cancel all batches on errors

**Version 0.2.74**

- Large job commands are now written to GCS to avoid Linux argument length and number limitations.

**Version 0.2.72**

- Made failed Python Jobs have non-zero exit codes.

**Version 0.2.71**

- Added the ability to set values for ``Job.cpu``, ``Job.memory``, ``Job.storage``, and ``Job.timeout`` to `None`

**Version 0.2.70**

- Made submitting ``PythonJob`` faster when using the ``ServiceBackend``

**Version 0.2.69**

- Added the option to specify either `remote_tmpdir` or `bucket` when using the ``ServiceBackend``

**Version 0.2.68**

- Fixed copying a directory from GCS when using the ``LocalBackend``
- Fixed writing files to GCS when the bucket name starts with a "g" or an "s"
- Fixed the error "Argument list too long" when using the ``LocalBackend``
- Fixed an error where memory is set to None when using the ``LocalBackend``

**Version 0.2.66**

- Removed the need for the ``project`` argument in ``Batch()`` unless you are creating a PythonJob
- Set the default for ``Job.memory`` to be 'standard'
- Added the `cancel_after_n_failures` option to ``Batch()``
- Fixed executing a job with ``Job.memory`` set to 'lowmem', 'standard', and 'highmem' when using the
  ``LocalBackend``
- Fixed executing a ``PythonJob`` when using the ``LocalBackend``

**Version 0.2.65**

- Added ``PythonJob``
- Added new ``Job.memory`` inputs `lowmem`, `standard`, and `highmem` corresponding to ~1Gi/core, ~4Gi/core, and ~7Gi/core respectively.
- ``Job.storage`` is now interpreted as the desired extra storage mounted at `/io` in addition to the default root filesystem `/` when
  using the ServiceBackend. The root filesystem is allocated 5Gi for all jobs except 1.25Gi for 0.25 core jobs and 2.5Gi for 0.5 core jobs.
- Changed how we bill for storage when using the ServiceBackend by decoupling storage requests from CPU and memory requests.
- Added new worker types when using the ServiceBackend and automatically select the cheapest worker type based on a job's CPU and memory requests.

**Version 0.2.58**

- Added concatenate and plink_merge functions that use tree aggregation when merging.
- BatchPoolExecutor now raises an informative error message for a variety of "system" errors, such as missing container images.

**Version 0.2.56**

- Fix ``LocalBackend.run()`` succeeding when intermediate command fails

**Version 0.2.55**

- Attempts are now sorted by attempt time in the Batch Service UI.

**Version 0.2.53**

- Implement and document ``BatchPoolExecutor``.

**Version 0.2.50**

- Add ``requester_pays_project`` as a new parameter on batches.

**Version 0.2.43**

- Add support for a user-specified, at-most-once HTTP POST callback when a Batch completes.

**Version 0.2.42**

- Fixed the documentation for job memory and storage requests to have default units in bytes.
