// Store API clients. Tokens stay in memory; receipts contain only store resource IDs and states.
import { createHmac, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
export function appleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'ES256', kid: env.ASC_KEY_ID, typ: 'JWT' })}.${b64({ iss: env.ASC_ISSUER_ID, iat: now - 30, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  return `${input}.${sign('sha256', Buffer.from(input), { key: readFileSync(env.ASC_KEY_PATH), dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}
export function amoToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: env.AMO_JWT_ISSUER, jti: randomUUID(), iat: now - 30, exp: now + 120 })}`;
  return `${input}.${createHmac('sha256', env.AMO_JWT_SECRET).update(input).digest('base64url')}`;
}
export function chromeToken(env) {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token', '--verbosity=error', `--impersonate-service-account=${env.CWS_SERVICE_ACCOUNT}`, '--scopes=https://www.googleapis.com/auth/chromewebstore'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
  } catch {
    throw new Error('Google token unavailable. Run gcloud auth login; the account must be able to impersonate CWS_SERVICE_ACCOUNT.');
  }
}

export async function request(url, token, method = 'GET', body, headers = {}, scheme = 'Bearer') {
  const json = body && !(body instanceof FormData) && !(body instanceof Uint8Array);
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `${scheme} ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(body) : body,
  });
  const text = await response.text();
  let result;
  try { result = text ? JSON.parse(text) : {}; } catch { throw new Error(`${new URL(url).hostname}: non-JSON response (HTTP ${response.status})`); }
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname}: HTTP ${response.status}: ${JSON.stringify(result).slice(0, 3000)}`);
    error.status = response.status;
    throw error;
  }
  return result;
}
export async function poll(check, label, minutes = 30) {
  const until = Date.now() + minutes * 60000;
  do {
    const result = await check();
    if (result) return result;
    console.log(`${label}; checking again in 15 seconds…`);
    await delay(15000);
  } while (Date.now() < until);
  throw new Error(`${label}: timed out. Rerun submit to resume; do not create another build.`);
}
export const chromePath = env => `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
export const chromeStatus = env => request(`https://chromewebstore.googleapis.com/v2/${chromePath(env)}:fetchStatus`, chromeToken(env));
export const amoPath = env => `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(env.AMO_ADDON_ID)}`;
const amoRequest = (env, url, method, body) => request(url, amoToken(env), method, body, {}, 'JWT');
export const amo = (env, suffix, method, body) => amoRequest(env, `${amoPath(env)}${suffix}`, method, body);
export const apple = (env, path, method, body) => request(`https://api.appstoreconnect.apple.com/v1${path}`, appleToken(env), method, body);
const resource = (type, id) => ({ data: { type, id } });
const document = (type, attributes, relationships = {}, id) => ({ data: { type, ...(id ? { id } : {}), attributes, relationships } });

export async function appleApp(env) {
  const result = await apple(env, `/apps?filter[bundleId]=${encodeURIComponent(env.ASC_BUNDLE_ID)}`);
  if (result.data.length !== 1) throw new Error(`Expected one existing Apple app for ${env.ASC_BUNDLE_ID}; create its record in App Store Connect first.`);
  return result.data[0].id;
}

export async function appleBuild(env, manifest, platform, app) {
  const result = await apple(env, `/builds?filter[app]=${app}&filter[version]=${encodeURIComponent(manifest.buildNumber)}&filter[preReleaseVersion.version]=${encodeURIComponent(manifest.version)}&filter[preReleaseVersion.platform]=${platform}&include=preReleaseVersion&limit=200`);
  return result.data.find(build => build.attributes.version === manifest.buildNumber);
}

export async function submitChrome(env, manifest, receipt, save) {
  const version = manifest.version;
  const status = await chromeStatus(env);
  for (const key of ['publishedItemRevisionStatus', 'submittedItemRevisionStatus']) {
    const revision = status[key];
    if (revision?.distributionChannels?.some(c => c.crxVersion === version)) {
      if (receipt.packageSHA256 !== manifest.files.chrome.sha256) throw new Error(`Chrome ${version} already exists and cannot be matched to these package bytes. Use a new version or the original release workspace.`);
      if (!['PENDING_REVIEW', 'PUBLISHED', 'STAGED'].includes(revision.state)) throw new Error(`Chrome ${version}: ${revision.state}. Resolve it in the dashboard.`);
      receipt.state = revision.state;
      receipt.submitted = true;
      save();
      console.log(`Chrome ${version}: already ${revision.state}; no upload repeated.`);
      return;
    }
  }
  // fetchStatus also retains cancelled/rejected submissions; those do not occupy the review slot.
  if (status.submittedItemRevisionStatus && !['CANCELLED', 'REJECTED'].includes(status.submittedItemRevisionStatus.state)) throw new Error('Chrome has another submission. Resolve it in the dashboard before replacing it.');
  const api = `https://chromewebstore.googleapis.com/v2/${chromePath(env)}`;
  if (!receipt.uploaded) {
    const uploaded = await request(`https://chromewebstore.googleapis.com/upload/v2/${chromePath(env)}:upload`, chromeToken(env), 'POST', readFileSync(manifest.files.chrome.path), { 'Content-Type': 'application/zip' });
    receipt.uploadState = uploaded.uploadState;
    save();
    const state = ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(uploaded.uploadState)
      ? await poll(async () => { const s = (await chromeStatus(env)).lastAsyncUploadState; return ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(s) ? false : s; }, 'Chrome upload processing')
      : uploaded.uploadState;
    if (state !== 'SUCCEEDED') throw new Error(`Chrome upload failed: ${state}`);
    receipt.uploaded = true;
    receipt.packageSHA256 = manifest.files.chrome.sha256;
    save();
  }
  const result = await request(`${api}:publish`, chromeToken(env), 'POST', { publishType: 'STAGED_PUBLISH', blockOnWarnings: true });
  if (!['PENDING_REVIEW', 'STAGED', 'PUBLISHED'].includes(result.state)) throw new Error(`Chrome returned ${result.state}; submission not confirmed.`);
  receipt.state = result.state;
  receipt.submitted = true;
  save();
  console.log(`Chrome: ${result.state}; held for publication after approval.`);
}

export async function submitFirefox(env, manifest, receipt, save) {
  let existing;
  try { existing = await amo(env, `/versions/${encodeURIComponent(manifest.version)}/`); } catch (error) { if (error.status !== 404) throw error; }
  if (existing) {
    // Mozilla adds signature files, so a signed XPI's hash differs from the uploaded ZIP.
    const known = receipt.versionId === existing.id && receipt.packageSHA256 === manifest.files.firefox.sha256;
    if (!known && existing.file?.hash !== `sha256:${manifest.files.firefox.sha256}`) throw new Error('AMO already has this version and its package cannot be matched to this release. Bump the version or inspect the existing submission; it will not be replaced.');
    if (existing.is_disabled) throw new Error('This Firefox version is disabled; resolve its review status in AMO.');
    receipt.versionId = existing.id;
    receipt.state = existing.file.status;
    // An interrupted response can leave the version created before release/reviewer notes were set.
  } else {
    if (!receipt.uploadId) {
      const form = new FormData();
      form.set('upload', new Blob([readFileSync(manifest.files.firefox.path)]), `glaze-v${manifest.version}-firefox.zip`);
      form.set('channel', 'listed');
      const uploaded = await amoRequest(env, 'https://addons.mozilla.org/api/v5/addons/upload/', 'POST', form);
      receipt.uploadId = uploaded.uuid;
      save();
    }
    const upload = await poll(async () => {
      const result = await amoRequest(env, `https://addons.mozilla.org/api/v5/addons/upload/${encodeURIComponent(receipt.uploadId)}/`);
      return result.processed ? result : false;
    }, 'AMO package validation');
    if (!upload.valid) throw new Error(`AMO validation failed: ${JSON.stringify(upload.validation).slice(0, 2500)}`);
    const form = new FormData();
    form.set('upload', receipt.uploadId);
    form.set('source', new Blob([readFileSync(manifest.files.firefoxSource.path)]), `glaze-v${manifest.version}-source.zip`);
    const version = await amo(env, '/versions/', 'POST', form);
    receipt.versionId = version.id;
    receipt.packageSHA256 = manifest.files.firefox.sha256;
    receipt.state = version.file.status;
    save();
  }
  if (!existing?.source && existing) {
    const form = new FormData();
    form.set('source', new Blob([readFileSync(manifest.files.firefoxSource.path)]), `glaze-v${manifest.version}-source.zip`);
    await amo(env, `/versions/${receipt.versionId}/`, 'PATCH', form);
  }
  await amo(env, `/versions/${receipt.versionId}/`, 'PATCH', {
    release_notes: { 'en-US': manifest.notes },
    approval_notes: 'Reviewer source includes source/ and reviewer/. From its extracted root run python3 reviewer/rebuild.py verify. README.md explains the pinned vendor rebuilds. Local tests and lint do not establish live Firefox desktop/Android acceptance.',
  });
  receipt.submitted = true;
  save();
  console.log(`Firefox: version ${receipt.versionId}, file state ${receipt.state}. AMO publishes listed versions after approval.`);
}

export async function submitApple(env, manifest, receipt, save) {
  const app = await appleApp(env);
  for (const platform of manifest.applePlatforms) {
    const state = receipt[platform] ||= {};
    const builds = await poll(async () => {
      const build = await appleBuild(env, manifest, platform, app);
      if (!build || build.attributes.processingState === 'PROCESSING') return false;
      if (build.attributes.processingState !== 'VALID' || build.attributes.expired) throw new Error(`Apple ${platform}: build ${manifest.buildNumber} is ${build.attributes.processingState} or expired.`);
      return build;
    }, `Apple ${platform} build processing`);
    const versions = await apple(env, `/apps/${app}/appStoreVersions?filter[platform]=${platform}&filter[versionString]=${manifest.version}`);
    let version = versions.data[0];
    const versionState = version?.attributes.appVersionState || version?.attributes.appStoreState;
    if (version && ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'PENDING_APPLE_RELEASE', 'PROCESSING_FOR_APP_STORE', 'PROCESSING_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'ACCEPTED'].includes(versionState)) {
      const linked = await apple(env, `/appStoreVersions/${version.id}/build`);
      if (linked.data?.id !== builds.id) throw new Error(`Apple ${platform}: this version is tied to a different build.`);
      state.submitted = true; state.state = versionState; save(); continue;
    }
    if (!version) {
      version = (await apple(env, '/appStoreVersions', 'POST', document('appStoreVersions', { platform, versionString: manifest.version, releaseType: 'MANUAL' }, { app: resource('apps', app) }))).data;
    }
    state.versionId = version.id;
    save();
    const submissions = await apple(env, `/apps/${app}/reviewSubmissions?filter[state]=READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES,CANCELING,COMPLETING&limit=200`);
    let submission;
    for (const candidate of submissions.data) {
      // Completed historical reviews can refer to a rejected version that is being submitted again.
      if (candidate.attributes.state === 'COMPLETE') continue;
      const items = await apple(env, `/reviewSubmissions/${candidate.id}/items?include=appStoreVersion&limit=200`);
      if (items.data.some(item => item.relationships?.appStoreVersion?.data?.id === version.id)) {
        if (candidate.attributes.state === 'READY_FOR_REVIEW' && items.data.some(item => item.relationships?.appStoreVersion?.data?.id !== version.id)) throw new Error('The Apple draft contains other review items. Submit or separate that draft in App Store Connect first.');
        submission = candidate;
        break;
      }
    }
    if (submission) {
      const linked = await apple(env, `/appStoreVersions/${version.id}/build`);
      if (linked.data?.id !== builds.id) throw new Error(`Apple ${platform}: the existing review draft uses a different build.`);
      if (version.attributes.releaseType !== 'MANUAL') throw new Error(`Apple ${platform}: change this existing draft to manual release in App Store Connect before submitting.`);
    }
    if (!submission) {
      await apple(env, `/appStoreVersions/${version.id}`, 'PATCH', document('appStoreVersions', { releaseType: 'MANUAL' }, {}, version.id));
      await apple(env, `/appStoreVersions/${version.id}/relationships/build`, 'PATCH', resource('builds', builds.id));
      const locales = await apple(env, `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`);
      if (!locales.data.length) throw new Error(`Apple ${platform}: no listing localization. Complete metadata and screenshots in App Store Connect, then rerun submit.`);
      for (const locale of locales.data) {
        // Change only English release notes; retain the other languages and all existing listing content.
        if (locale.attributes.locale.startsWith('en-')) await apple(env, `/appStoreVersionLocalizations/${locale.id}`, 'PATCH', document('appStoreVersionLocalizations', { whatsNew: manifest.notes }, {}, locale.id));
      }
      // Reuse an empty draft left by an interrupted create/item response, without submitting unrelated items.
      if (state.submissionId) {
        const candidate = (await apple(env, `/reviewSubmissions/${state.submissionId}`)).data;
        const items = await apple(env, `/reviewSubmissions/${candidate.id}/items?limit=200`);
        if (candidate.attributes.state === 'READY_FOR_REVIEW' && !items.data.length) submission = candidate;
      }
      submission ||= (await apple(env, '/reviewSubmissions', 'POST', document('reviewSubmissions', { platform }, { app: resource('apps', app) }))).data;
      state.submissionId = submission.id; save();
      await apple(env, '/reviewSubmissionItems', 'POST', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: resource('reviewSubmissions', submission.id), appStoreVersion: resource('appStoreVersions', version.id) } } });
    }
    if (submission.attributes.state === 'READY_FOR_REVIEW') await apple(env, `/reviewSubmissions/${submission.id}`, 'PATCH', document('reviewSubmissions', { submitted: true }, {}, submission.id));
    else if (!['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETING', 'COMPLETE'].includes(submission.attributes.state)) throw new Error(`Apple submission ${submission.id}: ${submission.attributes.state}. Resolve App Review issues before retrying.`);
    state.submissionId = submission.id;
    state.state = (await apple(env, `/reviewSubmissions/${submission.id}`)).data.attributes.state;
    if (!['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETING', 'COMPLETE'].includes(state.state)) throw new Error(`Apple submission ${submission.id}: ${state.state}; submission not confirmed.`);
    state.submitted = true;
    save();
    console.log(`Apple ${platform}: ${state.state}; manual release after approval.`);
  }
  receipt.submitted = true;
  save();
}
