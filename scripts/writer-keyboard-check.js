// Keyboard journeys on the synthetic paper. Focus is placed on the invoker, then only key events operate the UI.
module.exports = async ({ p, fr, check, until }) => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  const activate = async (locator) => { await locator.focus(); await p.keyboard.press('Enter'); };
  const menu = async (selector, label) => {
    await activate(fr.locator(selector));
    const buttons = fr.locator('.gp-menu [role^="menuitem"]');
    await until(() => buttons.count(), 'keyboard menu');
    const names = await buttons.allTextContents(), at = names.findIndex((n) => n.startsWith(label));
    if (at < 0) throw Error(`Missing keyboard menu item ${label}: ${names}`);
    await p.keyboard.press('Home');
    for (let i = 0; i < at; i++) await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
  };
  const dismiss = async (selector, label) => {
    await until(() => fr.locator(selector).isVisible(), label);
    check(await fr.evaluate((s) => !!document.activeElement?.closest(s), selector), `${label}: focus enters from keyboard`);
    await p.keyboard.press('Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Escape');
    await until(async () => !await fr.locator(selector).isVisible(), `${label} dismissed`);
    check(true, `${label}: Tab, Shift+Tab and Escape work`);
  };
  await menu('.gp-pill', 'APA 7');
  await until(() => fr.evaluate(() => GZ_WRITER_PAPER.current().format().id === 'apa7'), 'APA format saved');
  check(await fr.evaluate(() => GZ_WRITER_CITE.style() === 'apa7'), 'citations follow the selected paper format');
  await menu('.gp-pill', 'New preset'); await dismiss('.gp-form[aria-label="New preset…"]', 'New preset');
  await menu('.gp-more', 'Page setup'); await dismiss('.gp-page', 'Page setup');
  if (await fr.locator('.gp-pilcrow').isVisible()) await activate(fr.locator('.gp-pilcrow'));
  else await menu('.gp-more', 'Paragraph');
  await dismiss('.gp-para', 'Paragraph');
  await activate(fr.getByRole('button', { name: 'Footnote', exact: true })); await dismiss('.gp-note', 'Footnote');
  await menu('.gp-more', 'Header and footer'); await dismiss('.gp-hf', 'Header and footer');
  await activate(fr.getByRole('button', { name: 'Cite', exact: true })); await dismiss('.gz-cite', 'Cite');
  await menu('.gzo-insert', 'Special characters'); await dismiss('.gzo-chars', 'Special characters');
  await fr.evaluate(() => GZ_WRITER_PAPER.current().editor.view.focus());
  await p.keyboard.press(`${mod}+k`); await dismiss('.gzo-linkedit', 'Link');
  await p.keyboard.press(`${mod}+f`); await dismiss('.ge-find', 'Find');
  // Import's modal traps in both directions; Escape leaves the current document alone.
  await fr.evaluate(async () => {
    const bytes = (await GZ_WRITER_PAPER.current().docx()).bytes;
    await GZ_WRITER_IMPORT.bring(GZ_WRITER_PAPER.current(), new File([bytes], 'keyboard-copy.docx'));
  });
  await dismiss('.gi-card', 'Import choice');
  await activate(fr.locator('.gp-submit')); await dismiss('.gs-sheet', 'Submit');
};
