// Google Drive v3 shapes for test/drive.test.js and scripts/drive-files-check.js, copied from Google's own documents, never
// guessed: the File resource from the discovery document (schemas.File, revision 20261028) and the error bodies from Drive's
// "Resolve errors" guide, both fetched 2026-10-30 and kept in glaze-plans/release-4.0.1/e3/ (drive-v3-discovery-2026-10-30.json,
// drive-handle-errors-2026-10-30.html). The guide's own examples have JSON slips (trailing commas, a stray `s`): fixed here,
// nothing else changed. live: false on each until the owner records Drive's answers from a dev build (scripts/dev-drive.sh).
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
};
module.exports = { MIME, FILES, SAVED, ERRORS };
