# SculptGL WebXR Project Rules

## 🚨 ZERO TOLERANCE PROTOCOLS
> [!IMPORTANT]
> **VIOLATION OF THESE 3 RULES WILL RESULT IN SESSION TERMINATION.**

1.  **Step ID Prefix**:
    *   **Rule**: EVERY SINGLE RESPONSE must start with `Step Id: {id}`.
    *   **Check**: Look at the user's last message `Step Id`. Increment it. Put it at the very start.
    *   **NO EXCEPTIONS**.

2.  **Deployment Protocol (CI/CD) [DISABLED FOR VITE PHASE]**:
    *   **Rule**: Do NOT use `./deploy_beta.sh` or `./deploy.sh`.
    *   **Process**: Rely entirely on the local Vite server (`npm run dev`) for all testing.
    *   **Reasoning**: Local Vite provides HMR and faster iteration.

3.  **Debug Visibility**:
    *   **Rule**: `VERSION` and `Build Description` MUST be visible in VR/Screen Log.
    *   **Implementation**: Verify `GuiXR.draw` renders the version string.
    *   **Console**: Log the version immediately on startup.

## 🚀 Release Workflow
**Goal:** Maintain a clean history and simple README while keeping full records.

1.  **Documentation**:
    -   **Add** new release notes to top of `docs/releases.md`.
    -   **Update** `README.md`: Keep only the **latest 3 releases**. Link to `docs/releases.md` for older history.
2.  **Version**:
    -   **Increment** version in `index.html` (e.g., `<title>SculptXR v0.7.121</title>`).
3.  **Deploy**:
    -   Run `./deploy.sh` (Production) or `./deploy_beta.sh` (Beta).
    -   Script will auto-check git tags and refuse overwrite (unless `FORCE=1`).

## Workflow Rules (STRICT ADHERENCE)
1. **PLANNING MODE IS SACRED**: When in "Planning Mode" or asked to "Plan", **NO CODE EDITS** are permitted. Analysis and reading only.
2. **VITE FIRST**: ALL code testing must be done locally via Vite.
3. **PRODUCTION LOCK**: Production deployment (`sculptvr`) is **FORBIDDEN**.
4. **VR VERIFICATION**: You may request VR testing locally.
5. **ROLLBACK CAUTION**: Do not perform blind rollbacks. Stop and Plan.
6. **MANUAL COMMIT**:
    *   **NEVER automatically commit changes.** Wait for explicit user request/approval.
    *   **NEVER automatically deploy to PRODUCTION.**
    *   **Beta Deployment is currently disabled.**

## Commit Protocol
**"Explicit Commits Only"**
1.  **NEVER autonomously commit to git**: Do not run `git commit` unless the user explicitly asks you to. 
2.  **Keep the Log Clean**: The user prefers to keep the git log free of broken, WIP, or intermediate commits.
3.  **Wait for the Prompt**: When a feature is working and deployed to Beta, wait for the user to confirm it works and explicitly request a commit before pushing it to the history.

## The "Paranoid Commit" Protocol
**Trigger**: Before aggressive edits, after major milestones, or when explicitly requested.
**Goal**: Zero-risk rollback. Ability to reconstruct code from English docs alone if git fails.
**Steps**:
1.  **Commit EVERYTHING**: `git add .` (No partial commits. All config/scripts included).
2.  **Documentation of Truth**: Update `walkthrough.md` (or a specific checkpoint doc) with a **Plain English Reconstruction Guide**.
    *   *Standard*: "Could a stranger rewrite this feature from scratch reading *only* this doc?"
    *   *Must include*: Key logic changes, math derivations, and specific file modifications.
3.  **Tag**: Start commit message with `[PARANOID]`.

## Versioning & Debugging Protocol
1.  **ALWAYS Increment**: Every new attempt gets a new version number (Minor/Patch). NEVER reuse a version string. **Even for small changes or tests.**
2.  **ALWAYS Display**: Version string MUST be visible in the top-left black debug square (`#log` in `xr_poc.html`).
3.  **ALWAYS Describe**: Format MUST be `v{Major}.{Minor}.{Patch} - {Short Task Description}` (e.g., `v0.4.33 - Fix Lighting`).
4.  **Console Override**: Ensure `console.log` is redirected to this `#log` window so errors are visible in VR.

## Documentation Standards
1.  **Rule Zero**: `project_rules.md` is the **Repo Constitution**. It is the only file guaranteed to be valid across sessions. If a rule isn't here, it's just a suggestion.
2.  **Knowledge Items**: Used for long-term technical context (how X works), not for active project constraints.
3.  **Naming**: Stop inventing new doc names. Stick to:
    -   `task.md` (Checklist)
    -   `implementation_plan.md` (Design)
    -   `project_rules.md` (Constraints)
4.  **Task Initialization**: ALWAYS initialize `task.md` by copying the header from `task_template.md`. This ensures Critical Rules remain in active context.


## VR Implementation Rules
1.  **Single Source of Truth**: `Scene.js` is the sole handler for VR input (`handleXRInput`). Do not spread logic across `SculptGL.js`.
2.  **Array Strictness**: Always explicitly convert WebXR `DOMPoint`/`Float32Array` data to standard Arrays or TypedArrays when passing to `gl-matrix` functions.
3.  **Traceability**: New features must have a "Deep Trace" logging mode available (controlled by a flag) to prove execution.
4.  **Count Braces**: Before running deep debugging, verify brace counts and syntax. Use browser subagent to verify syntax errors quickly.

## Tool Usage & Verification
1.  **Verify Tool Output**: When using `multi_replace_file_content` or similar tools, ALWAYS check the output message. If it says "target content not found", STOP and investigate. Do not assume success.
2.  **No Blind Edits**: View the file context before editing to ensure `TargetContent` is exact.
3.  **No Autonomous Browser Testing**: DO NOT use the `browser_subagent` to test the application unless explicitly requested by the user. Request manual testing instead.

## Environment & Build System
1.  **Local Testing (Vite)**: For fast, live local testing and remote debugging (e.g., with GalaxyXR), the project directly uses Vite in the root directory.
    -   *Workflow*: Run `npm run dev` from the main `sculptxr` directory (`/Users/mattestela/.gemini/jetski/scratch/sculptxr/`). It serves the app locally via HTTPS (e.g., `https://localhost:8084/`) which is required for WebXR.
    -   *Hot Module Replacement*: Vite provides HMR, making iteration much faster. WebXR sessions may still require manual headset refreshes.
    -   *Agent Rule*: Rely on this Vite server being active for immediate local testing. Do NOT attempt to run `npm run build` or use deploy scripts for local testing.
2.  **Deploy Scripts (Beta/Prod - Future Use)**: For publishing to an external website, the legacy `./deploy.sh` or `./deploy_beta.sh` scripts are available in the main `sculptxr` directory. These are currently only for future external public deployments.
3.  **Environment First**: Any change required to *run* the app MUST be committed **immediately** upon verification.
4.  **No "Floating" Configs**: Never leave environment fixes in an uncommitted state while working on features.
5.  **Revert Safety**: Before reverting (`git checkout .`), ALWAYS check `git status` for uncommitted config files.

## Deployment Details
**Script**: `./deploy.sh [USER] [HOST] [DEST_PATH]`
-   **CRITICAL**: User MUST be `tokeruadmin`. Do not use `mattestela` or `root`.
-   **Auth**: Requires SSH Key + **Physical Security Key Tap**.
    -   *Agent Protocol*: Agent **should** attempt `./deploy.sh`. If it hangs/fails, ask user to "Please Tap Key".
-   **Deployment Safety (Version Guard)**:
    -   Script automatically parses `index.html` for `VERSION: vX.Y.Z`.
    -   Compares against `.last_deployed_version` (PROD) or `.last_deployed_beta` (BETA).
    -   **Rule**: Version must be strictly greater than last deployed (unless using FORCE).
    -   **Channels**:
        -   `./deploy_beta.sh` (Beta Testing)
        -   `./deploy.sh` (Production - requires approval)
    -   **Auto-Sync**: The script automatically updates `src/Version.js` loops.
-   **Caching**: User utilizes "Application -> Clear Site Data" in DevTools to ensure fresh code. Do not manually bump version query strings.

## Desktop Preview Protocol
-   **Goal**: Iterate on VR Menu layouts without putting on the headset.
-   **Command**: `Shift + Alt + V` (or `app.guiXR.togglePreview()` in console).
-   **Usage**: Opens a 1:1 overlay of the VR Menu texture on the desktop screen. Mouse acts as the VR Pointer.

## Handover Protocol
**When to create**: At the end of EVERY session, or when hitting a blocking issue.
**File Naming**: `handover_prompt_latest.md` (refers to `handover_prompt.md`).
**Template**:
```markdown
# Handover Prompt (Protocol Enforced)

**Project Status**:
**Current Working Directory**:
**Checkpoint**:

## Deployed Version
- **Beta**: vX.Y.Z
- **Prod**: vX.Y.Z

## Interactive Debugging
- **Preference**: Use browser console for immediate state inspection.
- **Workflow**: Provide copy-pasteable snippets.
```

## Communication Style
1.  **NO EMOJIS**: Do not use emojis in ANY response, title, task name, or commit message. Zero tolerance.
2.  **Professional Tone**: Keep all communication professional, concise, and sober.
3.  **No False Confidence**: Do not use words like "final", "real", "definitive", "corrected" to describe a solution. Use "updated", "new iteration", "attempt".
4.  **Step ID Prefix**: ALWAYS prefix your chat response with "Step Id: {id}".
