// Google Drive v3 shapes for test/documents/drive.test.js and checks/documents/drive-files-check.js, copied from Google's own documents, never
// guessed: the File resource from the discovery document (schemas.File, revision 20261028) and the error bodies from Drive's
// "Resolve errors" guide, both fetched 2026-10-30 and kept in glaze-plans/release-4.0.1/e3/ (drive-v3-discovery-2026-10-30.json,
// drive-handle-errors-2026-10-30.html). The guide's own examples have JSON slips (trailing commas, a stray `s`): fixed here,
// nothing else changed. live: false on each until the owner records Drive's answers from a dev build (tools/dev/dev-drive.sh).
// What the discovery document says that Glaze relies on:
//   File.size is a string (int64), "Size in bytes of blobs and Google Workspace editor files", absent for shortcuts and
//   folders: a Google Doc's size is its own, not its export's.
//   files.export: "the exported content is limited to 10 MB"; its query takes mimeType only.
//   files.get with alt=media downloads; create is POST /upload/drive/v3/files, update PATCH /upload/drive/v3/files/{fileId}.
//   A reply carries only the fields asked for (fields=…).
'use strict';
const MIME = {
  doc: 'application/vnd.google-apps.document', sheet: 'application/vnd.google-apps.spreadsheet', slides: 'application/vnd.google-apps.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf',
};
// files.get?fields=id,name,mimeType,size,trashed,capabilities(canEdit,canDownload): what Drive returns for that mask.
const file = (o = {}) => ({ id: '1AbC_d-EfGh', name: 'Essay.docx', mimeType: MIME.docx, size: '24576', trashed: false, capabilities: { canEdit: true, canDownload: true }, ...o });
const FILES = {
  live: false,
  docx: file(),
  pdf: file({ id: '1PdF_x', name: 'Reading.pdf', mimeType: MIME.pdf, size: '1048576' }),
  // A Google Doc: its size is the editor file's (discovery: "and Google Workspace editor files").
  doc: file({ id: '1GdOc_y', name: 'Lab notes', mimeType: MIME.doc, size: '1234' }),
  sheet: file({ id: '1GsHt_z', name: 'Budget', mimeType: MIME.sheet, size: '2048' }),
  slides: file({ id: '1GsLd_w', name: 'Talk', mimeType: MIME.slides, size: '4096' }),
  trashed: file({ trashed: true }),
  readOnly: file({ capabilities: { canEdit: false, canDownload: true } }),
};
// The create and update replies, fields=id,name,mimeType.
const SAVED = { live: false, file: { id: '1NeW_f1', name: 'Essay.docx', mimeType: MIME.docx }, doc: { id: '1NeW_d1', name: 'Essay', mimeType: MIME.doc } };
// Drive's error format (the guide): { error: { errors: [{ domain, reason, message, … }], code, message } }.
const error = (code, reason, message, domain = 'global', extra = {}) => ({ error: { errors: [{ domain, reason, message, ...extra }], code, message } });
const ERRORS = {
  live: false,
  401: error(401, 'authError', 'Invalid Credentials', 'global', { locationType: 'header', location: 'Authorization' }),
  insufficientFilePermissions: error(403, 'insufficientFilePermissions', 'The user does not have sufficient permissions for file {fileId}.'),
  appNotAuthorizedToFile: error(403, 'appNotAuthorizedToFile', 'The user has not granted the app {appId} {verb} access to the file {fileId}.'),
  userRateLimitExceeded: error(403, 'userRateLimitExceeded', 'User Rate Limit Exceeded', 'usageLimits'),
  storageQuotaExceeded: error(403, 'storageQuotaExceeded', "The user's Drive storage quota has been exceeded."),
  404: { error: { errors: [{ domain: 'global', reason: 'notFound', message: 'File not found {fileId}' }], code: 404, message: 'File not found: {fileId}' } },
  429: error(429, 'rateLimitExceeded', 'Rate Limit Exceeded', 'usageLimits'),
  // files.export past its 10 MB, which the guide doesn't list: Drive's answer as googleapis/google-api-nodejs-client#3446
  // (2024-02-28) printed it whole, and the older 403 as Google's Go client logged it ("googleapi: Error 403: This file is too
  // large to be exported., exportSizeLimitExceeded", rclone and TrueNAS reports; its domain is the format's usual one).
  exportSize: error(400, 'badRequest', 'This file is too large to be exported.', 'global', { location: 'export.size', locationType: 'other' }),
  exportSizeLimitExceeded: error(403, 'exportSizeLimitExceeded', 'This file is too large to be exported.'),
};
// Sync Documents (lib/drive-sync.js), from the same discovery document's schemas (revision 20261028; the parts it uses
// copied to glaze-plans/release-4.0.1/e5/drive-v3-sync-shapes-2026-10-30.json): StartPageToken, ChangeList, Change and
// FileList, and the File fields sync reads. Not seen live (live: false) until the owner records Drive's answers. What it says:
//   StartPageToken { kind: "drive#startPageToken", startPageToken }; a page token "doesn't expire".
//   ChangeList { kind: "drive#changeList", changes, nextPageToken (absent at the end), newStartPageToken (only at the end) }.
//   Change { kind: "drive#change", changeType ("file" or "drive"), time (RFC 3339), removed, fileId, file (absent once
//   removed: "by deletion or loss of access") }.
//   File.version: int64 as a string, "monotonically increasing", every change; headRevisionId: "only available for files with
//   binary content"; appProperties: "private to the requesting app", a null value clears one in an update; explicitlyTrashed
//   versus trashed (a trashed folder's files are trashed, not explicitly).
const SYNC_FIELDS = ['id', 'name', 'mimeType', 'parents', 'trashed', 'explicitlyTrashed', 'appProperties', 'headRevisionId', 'version', 'size'];
const folder = { id: '1GlZ_fold', name: 'Glaze', mimeType: 'application/vnd.google-apps.folder', parents: ['0AroOt_pVA'], trashed: false, explicitlyTrashed: false, appProperties: { glaze: 'root' }, version: '3' };
const sidecar = { id: '1JsN_side', name: 'Essay.glaze.json', mimeType: 'application/json', parents: [folder.id], trashed: false, explicitlyTrashed: false,
  appProperties: { glaze: 'doc', key: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', sum: 'ab'.repeat(32), rev: '7' }, headRevisionId: '0B4mJsNrEv1', version: '5', size: '2048' };
const SYNC = {
  live: false,
  fields: SYNC_FIELDS,
  start: { kind: 'drive#startPageToken', startPageToken: '1234' },
  folder,
  sidecar,
  export: { ...sidecar, id: '1DoC_exp', name: 'Essay.docx', mimeType: MIME.docx, appProperties: { glaze: 'file', key: sidecar.appProperties.key, sum: sidecar.appProperties.sum }, headRevisionId: '0B4mDoCrEv1', version: '4', size: '24576' },
  list: { kind: 'drive#fileList', incompleteSearch: false, files: [folder] },
  // A page with more to come, then the last page: a file changed, one trashed (its folder's own state is its), one gone.
  changes: {
    kind: 'drive#changeList', nextPageToken: '1240',
    changes: [{ kind: 'drive#change', changeType: 'file', time: '2026-10-30T15:04:05.123Z', removed: false, fileId: sidecar.id, file: sidecar }],
  },
  last: {
    kind: 'drive#changeList', newStartPageToken: '1251',
    changes: [
      { kind: 'drive#change', changeType: 'file', time: '2026-10-30T15:05:00.000Z', removed: false, fileId: '1DoC_exp', file: { ...sidecar, id: '1DoC_exp', name: 'Essay.docx', mimeType: MIME.docx, trashed: true, explicitlyTrashed: true } },
      { kind: 'drive#change', changeType: 'file', time: '2026-10-30T15:06:00.000Z', removed: true, fileId: '1GoNe_x' },
    ],
  },
};
module.exports = { MIME, FILES, SAVED, ERRORS, SYNC };
