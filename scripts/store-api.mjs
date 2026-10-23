// Store API clients. Tokens stay in memory; receipts contain only store resource IDs and states.
import { createHmac, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { describeChanges } from './store-listings.mjs';

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
  const hideToken = text => String(text).split(token).join('[redacted]');
  const json = body && !(body instanceof FormData) && !(body instanceof Uint8Array);
  let response, text;
  try {
    response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(120000),
    headers: { Authorization: `${scheme} ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(body) : body,
    });
    text = await response.text();
  } catch (error) { throw new Error(hideToken(error.message)); }
  let result;
  try { result = text ? JSON.parse(text) : {}; } catch { throw new Error(`${new URL(url).hostname}: non-JSON response (HTTP ${response.status})`); }
  if (!response.ok) {
    const error = new Error(`${new URL(url).hostname}: HTTP ${response.status}: ${hideToken(JSON.stringify(result)).slice(0, 3000)}`);
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
  const result = await request(`${api}:publish`, chromeToken(env), 'POST', { publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true });
  if (!['PENDING_REVIEW', 'STAGED', 'PUBLISHED'].includes(result.state)) throw new Error(`Chrome returned ${result.state}; submission not confirmed.`);
  receipt.state = result.state;
  receipt.submitted = true;
  save();
  console.log(`Chrome: ${result.state}; goes live once approved.`);
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
    release_notes: Object.fromEntries(Object.values(manifest.listings).map(l => [l.amoLocale, l.firefox.notes])),
    approval_notes: 'Reviewer source includes source/ and reviewer/. From its extracted root run python3 reviewer/rebuild.py verify. README.md explains the pinned vendor rebuilds. Local tests and lint do not establish live Firefox desktop/Android acceptance.',
  });
  for (const line of describeChanges((await syncFirefoxListing(env, manifest.listings)).filter(c => c.action !== 'same'))) console.log(line);
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
      version = (await apple(env, '/appStoreVersions', 'POST', document('appStoreVersions', { platform, versionString: manifest.version, releaseType: 'AFTER_APPROVAL' }, { app: resource('apps', app) }))).data;
    }
    if (!EDITABLE.includes(versionStateOf(version))) throw new Error(`Apple ${platform}: version is ${versionStateOf(version) || 'unknown'}; not editable.`);
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
      if (submission.attributes.state !== 'READY_FOR_REVIEW') throw new Error(`Apple submission ${submission.id}: ${submission.attributes.state}; not editable.`);
      const linked = await apple(env, `/appStoreVersions/${version.id}/build`);
      if (linked.data?.id !== builds.id) throw new Error(`Apple ${platform}: the existing review draft uses a different build.`);
      if (version.attributes.releaseType !== 'AFTER_APPROVAL') throw new Error(`Apple ${platform}: set this existing draft to release automatically after approval in App Store Connect before submitting.`);
    }
    if (!submission) {
      await apple(env, `/appStoreVersions/${version.id}`, 'PATCH', document('appStoreVersions', { releaseType: 'AFTER_APPROVAL' }, {}, version.id));
      await apple(env, `/appStoreVersions/${version.id}/relationships/build`, 'PATCH', resource('builds', builds.id));
    }
    const locales = await apple(env, `/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`);
    if (!locales.data.length) throw new Error(`Apple ${platform}: no listing localization. Complete metadata and screenshots in App Store Connect, then rerun submit.`);
    for (const line of describeChanges((await syncAppleListing(env, app, platform, version, manifest.listings)).filter(c => c.action !== 'same'))) console.log(line);
    if (!submission) {
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
    console.log(`Apple ${platform}: ${state.state}; released once approved.`);
  }
  receipt.submitted = true;
  save();
}


// AMO answers with descriptions and notes as it renders them (links through its redirector, quotes as entities), so
// text is compared as a reader sees it.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const visible = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ENTITIES[name]).replace(/\s+/g, ' ').trim();

// Brings the add-on's summary and description in line with the sources, only in the languages that differ. With write
// false it only reads and reports, release notes for the given version included.
export async function syncFirefoxListing(env, listings, { write = true, version } = {}) {
  const addon = await amo(env, '/');
  let notes = null;
  if (version) {
    try { notes = (await amo(env, `/versions/${encodeURIComponent(version)}/`)).release_notes || {}; } catch (error) { if (error.status !== 404) throw error; notes = {}; }
  }
  const changes = [], patch = {};
  const compare = (locale, field, have, want) => {
    const action = !have ? 'add' : visible(have) === visible(want) ? 'same' : 'change';
    changes.push({ store: 'Firefox', locale, field, action });
    return action !== 'same';
  };
  for (const { amoLocale, firefox } of Object.values(listings)) {
    for (const field of ['summary', 'description']) if (compare(amoLocale, field, addon[field]?.[amoLocale], firefox[field])) (patch[field] ||= {})[amoLocale] = firefox[field];
    if (notes) compare(amoLocale, 'release notes', notes[amoLocale], firefox.notes);
  }
  if (write && Object.keys(patch).length) await amo(env, '/', 'PATCH', patch);
  return changes;
}

// App info and version text can change only while a version is being prepared; never during or after review.
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'READY_FOR_REVIEW'];
const versionStateOf = version => version?.attributes?.appVersionState || version?.attributes?.appStoreState;
const VERSION_FIELDS = [['description', 'description'], ['keywords', 'keywords'], ['promotionalText', 'promotional text']];
const pick = (from, keys) => Object.fromEntries(keys.filter(key => from?.attributes?.[key]).map(key => [key, from.attributes[key]]));

// Brings one platform version's App Store text in line with the sources: name and subtitle on the editable app info
// (shared by both platforms), then description, keywords, promotional text and What's New on the version. Missing
// languages are created with English's URLs; Apple shows the primary language's screenshots for a language until it
// has its own. With write false it only reads and reports; base is the version to compare with when this one does
// not exist yet, and firstRelease says whether Apple will refuse What's New.
export async function syncAppleListing(env, app, platform, version, listings, { write = true, base, firstRelease = false } = {}) {
  const store = `Apple ${platform}`, changes = [], langs = Object.values(listings);
  const note = (locale, field, action, detail) => changes.push({ store, locale, field, action, ...(detail ? { detail } : {}) });
  const state = versionStateOf(version);
  if ((version || write) && !EDITABLE.includes(state)) {
    if (write) throw new Error(`Apple ${platform}: version is ${state || 'unknown'}; not editable.`);
    for (const { appleLocale } of langs) note(appleLocale, 'listing', 'skip', `version is ${state || 'unknown'}`);
    return changes;
  }
  const infos = (await apple(env, `/apps/${app}/appInfos`)).data;
  // A dry run before the version exists compares with the live app info, which the new version's copies.
  const info = infos.find(i => EDITABLE.includes(i.attributes.state || i.attributes.appStoreState)) || (!write && !version ? infos[0] : null);
  const infoLocales = info ? (await apple(env, `/appInfos/${info.id}/appInfoLocalizations?limit=200`)).data : [];
  const compared = version || base;
  const versionLocales = compared ? (await apple(env, `/appStoreVersions/${compared.id}/appStoreVersionLocalizations?limit=200`)).data : [];
  const find = (list, locale) => list.find(item => item.attributes.locale === locale);
  const missing = langs.filter(l => !find(versionLocales, l.appleLocale)).map(l => l.appleLocale);
  if (write && !info && missing.length) throw new Error(`Apple ${platform}: app info is not editable; cannot add ${missing.join(', ')}. Complete these languages in App Store Connect before submitting.`);
  const primaryInfo = find(infoLocales, 'en-US') || infoLocales[0], primary = find(versionLocales, 'en-US') || versionLocales[0];
  const primaryLocale = primary?.attributes.locale || 'en-US', added = [];
  let first = firstRelease;
  for (const { appleLocale: locale, apple: text } of langs) {
    let hasInfo = false;
    if (!info) note(locale, 'name and subtitle', 'skip', 'app info is not editable');
    else {
      const existing = find(infoLocales, locale), fields = { name: text.name, subtitle: text.subtitle };
      if (existing) {
        const changed = {};
        for (const key of ['name', 'subtitle']) {
          const same = (existing.attributes[key] || '') === fields[key];
          note(locale, key, same ? 'same' : 'change');
          if (!same) changed[key] = fields[key];
        }
        if (write && Object.keys(changed).length) await apple(env, `/appInfoLocalizations/${existing.id}`, 'PATCH', document('appInfoLocalizations', changed, {}, existing.id));
      } else {
        note(locale, 'name', 'create'); note(locale, 'subtitle', 'create');
        if (write) await apple(env, '/appInfoLocalizations', 'POST', document('appInfoLocalizations', { locale, ...fields, ...pick(primaryInfo, ['privacyPolicyUrl', 'privacyChoicesUrl', 'privacyPolicyText']) }, { appInfo: resource('appInfos', info.id) }));
      }
      hasInfo = true;
    }
    let target = find(versionLocales, locale);
    // Apple needs a language on the app info before a version can have it.
    if (!target && !hasInfo) continue;
    const fields = Object.fromEntries(VERSION_FIELDS.filter(([key]) => text[key]).map(([key]) => [key, text[key]]));
    if (target) {
      const changed = {};
      for (const [key, label] of VERSION_FIELDS) {
        if (!(key in fields)) continue;
        const same = (target.attributes[key] || '') === fields[key];
        note(locale, label, same ? 'same' : 'change');
        if (!same) changed[key] = fields[key];
      }
      if (write && Object.keys(changed).length) await apple(env, `/appStoreVersionLocalizations/${target.id}`, 'PATCH', document('appStoreVersionLocalizations', changed, {}, target.id));
    } else {
      for (const [key, label] of VERSION_FIELDS) if (key in fields) note(locale, label, 'create');
      added.push(locale);
      if (write) target = (await apple(env, '/appStoreVersionLocalizations', 'POST', document('appStoreVersionLocalizations', { locale, ...fields, ...pick(primary, ['supportUrl', 'marketingUrl']) }, { appStoreVersion: resource('appStoreVersions', version.id) }))).data;
    }
    // What's New goes on its own: Apple refuses the field for a platform's first release.
    if (first) note(locale, "What's New", 'skip', 'first release');
    else if (!target) note(locale, "What's New", 'create');
    else if ((target.attributes?.whatsNew || '') === text.whatsNew) note(locale, "What's New", 'same');
    else {
      note(locale, "What's New", 'change');
      if (write) {
        try {
          await apple(env, `/appStoreVersionLocalizations/${target.id}`, 'PATCH', document('appStoreVersionLocalizations', { whatsNew: text.whatsNew }, {}, target.id));
        } catch (error) {
          if (error.status !== 409 || !error.message.includes("Attribute 'whatsNew' cannot be edited at this time")) throw error;
          // Apple has no What's New field for a platform's first release. Keep all other metadata errors fatal.
          const history = await apple(env, `/apps/${app}/appStoreVersions?filter[platform]=${platform}&limit=2`);
          if (history.links?.next || history.data.length !== 1 || history.data[0].id !== version.id) throw error;
          console.log(`Apple ${platform}: first platform release; no What's New field.`);
          first = true;
          changes.pop(); note(locale, "What's New", 'skip', 'first release');
        }
      }
    }
    if (added.at(-1) === locale && locale !== primaryLocale) note(locale, 'screenshots', `${primaryLocale}'s until ${locale} has its own`);
  }
  return changes;
}

// The dry run for one platform: compares with this version if it exists, otherwise with the one it will copy (the live
// one, or the newest while none is live).
export async function previewAppleListing(env, platform, versionString, listings) {
  const app = await appleApp(env);
  const target = (await apple(env, `/apps/${app}/appStoreVersions?filter[platform]=${platform}&filter[versionString]=${versionString}`)).data[0];
  const versions = (await apple(env, `/apps/${app}/appStoreVersions?filter[platform]=${platform}&limit=20`)).data;
  const live = versions.find(v => ['READY_FOR_SALE', 'READY_FOR_DISTRIBUTION'].includes(versionStateOf(v))) || versions[0];
  const firstRelease = target ? versions.length === 1 && versions[0].id === target.id : !versions.length;
  return syncAppleListing(env, app, platform, target || null, listings, { write: false, base: live, firstRelease });
}
