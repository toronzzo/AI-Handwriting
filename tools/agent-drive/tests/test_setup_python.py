"""Gateway setup must not build LiteLLM with the Mac's Python 3.9."""

from agent_drive.setup import python_too_old, uv_release_name


def test_python_39_needs_uv_and_312_does_not() -> None:
    assert python_too_old((3, 9, 6)) is True
    assert python_too_old((3, 10, 0)) is False
    assert python_too_old((3, 12, 1)) is False


def test_uv_archive_matches_apple_silicon() -> None:
    assert uv_release_name("Darwin", "arm64") == "uv-aarch64-apple-darwin.tar.gz"
    assert uv_release_name("Linux", "x86_64") == "uv-x86_64-unknown-linux-gnu.tar.gz"
