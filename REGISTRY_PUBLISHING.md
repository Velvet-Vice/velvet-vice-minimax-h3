# Comfy Registry publishing

This repository is prepared for the Velvet Vice publisher account.

- Publisher ID: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.6`
- Repository: `https://github.com/Velvet-Vice/velvet-vice-minimax-h3`

## Automatic Comfy Registry publishing

The repository workflow publishes when `pyproject.toml` changes on `main`, and can also be run manually from GitHub Actions.

Required repository secret:

`REGISTRY_ACCESS_TOKEN`

The secret must contain a Comfy Registry publishing API key for publisher `velvet-vice`.

## Release consistency checklist

Before publishing a new version, update all version-bearing locations intentionally coupled to the package release:

- `pyproject.toml`
- `version.py`
- JavaScript package/version constants when release-specific
- README / changelog / release notes

## v1.4.6 Registry synchronization

Registry v1.4.5 had already been published before the final v1.4.5 Civitai/GitHub code synchronization. Therefore the finalized code is published to Comfy Registry as **v1.4.6** instead of attempting to overwrite the existing v1.4.5 Registry package.

The public Civitai v1.4.5 workflow remains compatible with Registry v1.4.6.

Do not mix isolated test-addon files into the public package.
