import { test, expect } from '@playwright/test';
import { gotoAuthed, openFirstContactOrSkip, skipWithoutCredentials } from './helpers';
// Labels come from the Spanish dictionary so a translation change breaks the build, not the suite silently.
import { es } from '../../src/lib/i18n/dictionaries/es';

skipWithoutCredentials();

// Sending is deliberately never exercised end-to-end: a real send would deliver
// a real email from a BD's mailbox. These cover the surface up to that point.
test.describe('Phase 2: Gmail connection and email composer', () => {
  test('Gmail account page offers a connect or reconnect control', async ({ page }) => {
    await gotoAuthed(page, '/account/email');

    // The h1 is the dictionary title ("conexión con gmail", rendered with a trailing dot).
    await expect(page.locator('main h1').first()).toContainText(new RegExp(es.accountEmail.title, 'i'));
    // accountEmail.connectButton / reconnectButton: which one shows depends on the
    // account's state (the test account has no Gmail, so "Conectar Gmail").
    const connect = page.getByRole('button', {
      name: new RegExp(`^(${es.accountEmail.connectButton}|${es.accountEmail.reconnectButton})$`),
    });
    await expect(connect.first()).toBeVisible();
  });

  test('Gmail account page surfaces an OAuth error from the callback', async ({ page }) => {
    await gotoAuthed(page, '/account/email?error=invalid_state');
    await expect(page.locator('text=invalid_state')).toBeVisible();
  });

  test('Contact record exposes the email composer', async ({ page }) => {
    const result = await openFirstContactOrSkip(page);
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.getByRole('button', { name: es.contactRecord.quickActionEmail, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: es.contactRecord.quickActionEmail });
    await expect(dialog).toBeVisible();

    // A contact without an address must say so rather than offer a dead composer.
    const draft = dialog.getByRole('button', { name: es.contactRecord.emailGenerateAction });
    const noEmail = dialog.getByText(es.contactRecord.emailNoAddress);
    await expect(draft.or(noEmail).first()).toBeVisible();
    // Closing never sends anything.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('Composer shows the destination address before drafting', async ({ page }) => {
    // Start from contacts whose email status is verified so the common case
    // is not skipped just because the first row has no address.
    const result = await openFirstContactOrSkip(page, '/contacts?view=all&emailStatus=verified');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await page.getByRole('button', { name: es.contactRecord.quickActionEmail, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: es.contactRecord.quickActionEmail });
    await expect(dialog).toBeVisible();
    test.skip((await dialog.getByText(es.contactRecord.emailNoAddress).count()) > 0, 'This contact has no email address.');

    await expect(dialog.getByLabel(es.contactRecord.emailToLabel, { exact: true })).toHaveValue(/.+@.+/);
    // Sending is never exercised: close the composer.
    await page.keyboard.press('Escape');
  });
});
