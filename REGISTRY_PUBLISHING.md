# Comfy Registry publishing

This repository is prepared for the Velvet Vice publisher account.

- Publisher ID: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.5`
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
- workflow custom-node metadata (`properties.cnr_id` and `properties.ver`)
- reference workflow filename
- JavaScript package/version constants when release-specific
- README / changelog / release notes

For the public/Civitai v1.4.5 workflow, use:

- `cnr_id = "velvet-vice-minimax-h3"`
- `ver = "1.4.5"`

## v1.4.5 publication rule

The v1.4.5 GitHub/Registry source must match the tested v1.4.5 Civitai custom-node package. Do not mix isolated test-addon files into the public package.
