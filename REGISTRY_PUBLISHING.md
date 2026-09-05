# Comfy Registry publishing

This repository is prepared for the Velvet Vice publisher account.

- Publisher ID: `velvet-vice`
- Node ID: `velvet-vice-minimax-h3`
- Version: `1.4.1`
- Repository: `https://github.com/Velvet-Vice/velvet-vice-minimax-h3`

## First GitHub publication

1. Create the GitHub repository `velvet-vice-minimax-h3` under the `Velvet-Vice` account/organization.
2. Upload the contents of this folder to the repository root.
3. Use `main` as the default branch.
4. Commit and push the files.

## Enable automatic Comfy Registry publishing

1. Create or reuse a Comfy Registry publishing API key for publisher `velvet-vice`.
2. In GitHub open **Settings → Secrets and variables → Actions**.
3. Create a repository secret named exactly `REGISTRY_ACCESS_TOKEN`.
4. Store the Comfy Registry publishing API key as the secret value.
5. Open **Actions → Publish to Comfy Registry → Run workflow** for the first publication.

After the first publication, future releases can be published by updating the semantic version in `pyproject.toml` and pushing that change to `main`.

## Release consistency checklist

Before publishing a new version, update all version-bearing locations that are intentionally coupled to the package release:

- `pyproject.toml`
- `version.py`
- workflow custom-node metadata (`properties.cnr_id` and `properties.ver`) for the public/Civitai workflow
- reference workflow filename when the public workflow version changes
- JavaScript package/version constants when they are release-specific
- README / changelog / release notes

For the public/Civitai v1.4.1 workflow, use:

- `cnr_id = "velvet-vice-minimax-h3"`
- `ver = "1.4.1"`
