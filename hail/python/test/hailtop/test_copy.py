import os

import pytest

from hailtop.aiotools.copy import _build_gcloud_transfer_groups, deduce_staging_directory


def f(src: str, dest: str):
    return {'from': src, 'to': dest}


def normalize(groups):
    return sorted((staging_dir, tuple(sorted(str(x) for x in files))) for staging_dir, files in groups)


def assert_valid_transfer_groups(groups, all_files):
    all_in_groups = [file for _, files in groups for file in files]
    assert sorted(str(x) for x in all_in_groups) == sorted(str(x) for x in all_files)
    for staging_dir, files in groups:
        assert staging_dir == deduce_staging_directory(files)
        for file in files:
            dest_dir = os.path.dirname(os.path.abspath(file['to']))
            assert os.path.commonpath([dest_dir, staging_dir]) == staging_dir, (
                f'{dest_dir} is not under staging dir {staging_dir}'
            )
        basenames = [file['from'].rstrip('/').split('/')[-1] for file in files]
        assert len(basenames) == len(set(basenames)), f'basename collision within transfer_group: {basenames}'


# Test cases for _build_gcloud_transfer_groups are defined as:
# - name: name of the test case
# - files: list of files to transfer
# - expected_groups: expected transfer_groups object result
TRANSFER_GROUP_CASES = [
    (
        'empty',
        [],
        [],
    ),
    (
        'single_file',
        [f('gs://bucket/a.txt', '/io/a.txt')],
        [('/io', [f('gs://bucket/a.txt', '/io/a.txt')])],
    ),
    (
        'no_collisions_same_dir',
        [
            f('gs://bucket/a.txt', '/io/a.txt'),
            f('gs://bucket/b.txt', '/io/b.txt'),
            f('gs://bucket/c.txt', '/io/c.txt'),
        ],
        [
            (
                '/io',
                [
                    f('gs://bucket/a.txt', '/io/a.txt'),
                    f('gs://bucket/b.txt', '/io/b.txt'),
                    f('gs://bucket/c.txt', '/io/c.txt'),
                ],
            )
        ],
    ),
    (
        'no_collisions_different_dirs',
        # No GCS basename collisions — all pack into one group.
        # Staging dir is the commonpath of /io/dir1 and /io/dir2, which is /io.
        [
            f('gs://bucket/a.txt', '/io/dir1/a.txt'),
            f('gs://bucket/b.txt', '/io/dir2/b.txt'),
        ],
        [
            (
                '/io',
                [
                    f('gs://bucket/a.txt', '/io/dir1/a.txt'),
                    f('gs://bucket/b.txt', '/io/dir2/b.txt'),
                ],
            )
        ],
    ),
    (
        'collision_splits_into_two_groups',
        [
            f('gs://bucket1/foo.txt', '/io/out1.txt'),
            f('gs://bucket2/foo.txt', '/io/out2.txt'),
        ],
        [
            ('/io', [f('gs://bucket1/foo.txt', '/io/out1.txt')]),
            ('/io', [f('gs://bucket2/foo.txt', '/io/out2.txt')]),
        ],
    ),
    (
        'triple_collision',
        [
            f('gs://bucket1/foo.txt', '/io/out1.txt'),
            f('gs://bucket2/foo.txt', '/io/out2.txt'),
            f('gs://bucket3/foo.txt', '/io/out3.txt'),
        ],
        [
            ('/io', [f('gs://bucket1/foo.txt', '/io/out1.txt')]),
            ('/io', [f('gs://bucket2/foo.txt', '/io/out2.txt')]),
            ('/io', [f('gs://bucket3/foo.txt', '/io/out3.txt')]),
        ],
    ),
    (
        'same_basename_different_dirs',
        # GCS basename collision (both foo.txt) → 2 groups regardless of dest dirs.
        [
            f('gs://bucket1/foo.txt', '/io/dir1/out.txt'),
            f('gs://bucket2/foo.txt', '/io/dir2/out.txt'),
        ],
        [
            ('/io/dir1', [f('gs://bucket1/foo.txt', '/io/dir1/out.txt')]),
            ('/io/dir2', [f('gs://bucket2/foo.txt', '/io/dir2/out.txt')]),
        ],
    ),
    (
        'collision_plus_non_colliding_packs_into_first_group',
        # foo.txt collides → 2 groups; bar.txt has no collision and packs into group 1.
        [
            f('gs://bucket1/foo.txt', '/io/out1.txt'),
            f('gs://bucket2/foo.txt', '/io/out2.txt'),
            f('gs://bucket1/bar.txt', '/io/out3.txt'),
        ],
        [
            ('/io', [f('gs://bucket1/foo.txt', '/io/out1.txt'), f('gs://bucket1/bar.txt', '/io/out3.txt')]),
            ('/io', [f('gs://bucket2/foo.txt', '/io/out2.txt')]),
        ],
    ),
    (
        'multiple_dirs_with_collisions',
        # foo.txt and bar.txt each collide once. Round-robin packs one of each per group → 2 groups.
        [
            f('gs://b1/foo.txt', '/io/dir1/out1.txt'),
            f('gs://b2/foo.txt', '/io/dir1/out2.txt'),
            f('gs://b1/bar.txt', '/io/dir2/out3.txt'),
            f('gs://b2/bar.txt', '/io/dir2/out4.txt'),
        ],
        [
            ('/io', [f('gs://b1/foo.txt', '/io/dir1/out1.txt'), f('gs://b1/bar.txt', '/io/dir2/out3.txt')]),
            ('/io', [f('gs://b2/foo.txt', '/io/dir1/out2.txt'), f('gs://b2/bar.txt', '/io/dir2/out4.txt')]),
        ],
    ),
    (
        'longest_common_subpath',
        # No basename collisions; staging dir is the longest common subpath of all dest dirs.
        [
            f('gs://bucket1/foo.txt', '/io/dir1/dir2/foo.txt'),
            f('gs://bucket1/bar.txt', '/io/dir1/dir2/bar.txt'),
            f('gs://bucket1/baz.txt', '/io/dir1/dir3/baz.txt'),
            f('gs://bucket2/qux.txt', '/io/dir1/dir3/qux.txt'),
        ],
        [
            (
                '/io/dir1',
                [
                    f('gs://bucket1/foo.txt', '/io/dir1/dir2/foo.txt'),
                    f('gs://bucket1/bar.txt', '/io/dir1/dir2/bar.txt'),
                    f('gs://bucket1/baz.txt', '/io/dir1/dir3/baz.txt'),
                    f('gs://bucket2/qux.txt', '/io/dir1/dir3/qux.txt'),
                ],
            )
        ],
    ),
    (
        'dirs_within_gcs_paths',
        # Both sources have GCS basename foo.txt → collision in flat staging → 2 groups.
        [
            f('gs://bucket1/x/foo.txt', '/io/dir1/x/foo.txt'),
            f('gs://bucket1/y/foo.txt', '/io/dir1/y/bar.txt'),
        ],
        [
            ('/io/dir1/x', [f('gs://bucket1/x/foo.txt', '/io/dir1/x/foo.txt')]),
            ('/io/dir1/y', [f('gs://bucket1/y/foo.txt', '/io/dir1/y/bar.txt')]),
        ],
    ),
    (
        'files_within_same_gcs_dir',
        # No basename collision; staging is commonpath of the dest dirs (both /io/dir1/x).
        [
            f('gs://bucket1/x/foo.txt', '/io/dir1/x/foo.txt'),
            f('gs://bucket1/x/bar.txt', '/io/dir1/x/bar.txt'),
        ],
        [
            (
                '/io/dir1/x',
                [
                    f('gs://bucket1/x/foo.txt', '/io/dir1/x/foo.txt'),
                    f('gs://bucket1/x/bar.txt', '/io/dir1/x/bar.txt'),
                ],
            )
        ],
    ),
    (
        'full_direcory_localization',
        [
            f('gs://bucket1/x/', '/io/dir1/x/'),
            f('gs://bucket1/y/', '/io/dir1/y/'),
        ],
        [
            (
                '/io/dir1',
                [
                    f('gs://bucket1/x/', '/io/dir1/x/'),
                    f('gs://bucket1/y/', '/io/dir1/y/'),
                ],
            )
        ],
    ),
]


@pytest.mark.parametrize(
    'files,expected_groups',
    [(files, expected) for _, files, expected in TRANSFER_GROUP_CASES],
    ids=[name for name, _, _ in TRANSFER_GROUP_CASES],
)
def test_transfer_groups(files, expected_groups):
    groups = _build_gcloud_transfer_groups(files)
    assert_valid_transfer_groups(groups, files)
    assert normalize(groups) == normalize(expected_groups)
