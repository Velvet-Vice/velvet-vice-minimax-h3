# Comfy Registry publishing

This repository is prepared for the Velvet Vice publisher account.

- Publisher ID: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.5.0`
- Repository: `https://github.com/Velvet-Vice/velvet-vice-minimax-h3`

## Automatic Comfy Registry publishing

The repository workflow publishes when `pyproject.toml` changes on `main`, and can also be run manually from GitHub Actions.

Required repository secret:

`REGISTRY_ACCESS_TOKEN`

The secret must contain a Comfy Registry publishing API key for publisher `velvet-vice`.

## Release consistency rule

Civitai ZIP, workflow metadata, GitHub package and Comfy Registry must use the same public version.

Current public version: **1.5.0**

For the current workflow use:

- `cnr_id = "velvet-vice-minimax-h3"`
- `ver = "1.5.0"`

Do not reuse an already-published Registry version and do not mix isolated test-addon files into the public package.
