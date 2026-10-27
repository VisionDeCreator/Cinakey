# Collaboration permission audit — October 27, 2026

Scope: current production/media/finance endpoints and the new publication/sharing flows.
This is a code and automated regression review; live multi-account release acceptance
is tracked separately in [the implementation checklist](collaboration-sharing-implementation.md).

| Operation family                                                               | Owner / Admin                                                     | Assigned Creator                                 | Unassigned Creator / Reviewer / outsider |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Read/edit a production, scripts, references, staging, timelines, project media | Allowed                                                           | Assigned projects or episodes of assigned series | Denied                                   |
| Start generation and authorize input media                                     | Allowed                                                           | Within assigned production and spending caps     | Denied                                   |
| Claim/renew timeline editing                                                   | Allowed                                                           | Assigned production                              | Denied                                   |
| Force takeover of another editor                                               | Allowed, audited                                                  | Denied                                           | Denied                                   |
| Begin/upload a publication                                                     | Allowed                                                           | Assigned production                              | Denied                                   |
| Continue an upload intent                                                      | Original publisher, with current production access                | Same rule                                        | Denied                                   |
| Download/delete stored export; create/revoke private links                     | Allowed                                                           | Assigned production                              | Denied                                   |
| Workspace balance, ledger, membership, assignments, spending-cap changes       | Allowed                                                           | Denied                                           | Denied                                   |
| Ownership transfer/account purge                                               | Existing explicit Owner checks and team-preservation guards       | Denied                                           | Denied                                   |
| Watch a shared export                                                          | Valid unexpired link, optional password and scoped viewer session | Same                                             | Same; no account needed                  |

## Findings and corrections

- Removed `isStaff` shortcuts from `canAccessProject`, `requireWorkspaceAccess`,
  `isWorkspaceOwner` and episode/series access. Staff can use explicitly guarded staff
  operations; a staff flag no longer silently grants production/media/wallet access in
  unrelated workspaces.
- Retained common authorization in project, script, timeline, asset/storage, entity,
  resource, reference, series and workspace operations. Service actions use their existing
  native admission/assertion operations, and generation admission rechecks current access.
- Timeline snapshot commits validate the current lease and expected parent. Publication
  upload admission and finalization recheck current user/project access; a removed Creator
  cannot finalize a new publication. Committed publications are immutable.
- Public share endpoints are separate from the authenticated `/v1` facade. Internal hash,
  session, finalization and storage operations remain inaccessible through public HTTP.
  Viewer authorization returns no production documents, wallet data or bearer storage URL.
- Public media authorization rechecks link revocation/expiry, viewer expiry, ready export
  state and project archival. Requests for explicit download also require download access.
  A secret for one link cannot grant access to another link or publication.
- Workspace ownership of existing shares survives member removal; management permissions
  are checked again for every action. Authorized teammates can revoke or delete them.
- Ready/staged publication files are protected from ordinary storage cleanup. Explicit
  publication deletion and full authorized account purge remove the publication/link/session
  graph first. Expired bound staged uploads have a separate worker cleanup path.

## Evidence

- `permissionMatrix.test.ts`: Owner, Admin, assigned/unassigned Creator, Reviewer and
  outside staff call production, timeline, media URL, stored-export, prompt-sheet and
  financial endpoints directly; UI visibility cannot bypass these checks.
- `teams.test.ts`, `series.test.ts`, `storage.test.ts`, `workspace.test.ts` and existing
  generation/production-safety tests cover assignments, removal, series media use,
  workspace isolation, reference authorization and write admission.
- `timelineLeases.test.ts`: stale tabs, expiry, Creator takeover denial and assignment loss.
- `publishedExports.test.ts`: immutable files, capacity reservation, upload fencing,
  unvalidated-upload denial, hashed sharing, password checks, revocation and session expiry.
- API boundary tests: anonymous upload/download/media denial and internal-operation hiding;
  authenticated raw MP4 bodies reach the upload handler intact.

No new support-impersonation flow, reviewer workflow, approvals or payment privileges
were introduced. This review does not claim a third-party security audit or completed
live browser acceptance.
