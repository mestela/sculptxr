# SculptXR Handover Prompt

## Current State
The project is currently at **v0.9.68**.
We recently updated the deployment scripts (`deploy.sh` and `deploy_beta.sh`) to automatically increment the patch version (e.g., `v0.9.67` -> `v0.9.68`) in `index.html` whenever the scripts are run and the version hasn't changed. This removes the need to manually increment the version in the HTML file prior to running a deployment, greatly speeding up iterative testing. 

## Status / Current Bug
The automation is successfully verified and functional. The `project_rules.md` has been updated to reflect that manual version bumping is no longer strictly required before running the deployment scripts.

**Pending Task:**
- Await the next assigned milestone from the user.