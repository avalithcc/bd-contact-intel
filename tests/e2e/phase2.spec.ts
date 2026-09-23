import { test, expect } from '@playwright/test';
import { gotoAuthed, openFirstOrSkip } from './helpers';

// Sending is deliberately never exercised end-to-end: a real send would deliver
// a real email from a BD's mailbox. These cover the surface up to that point.
test.describe('Phase 2: Gmail connection and email composer', () => {
  test('Gmail account page offers a connect or reconnect control', async ({ page }) => {
    await gotoAuthed(page, '/account/email');

    await expect(page.locator('h1')).toContainText(/Gmail/i);
    await expect(
      page.locator('button', { hasText: /Connect Gmail|Reconnect Gmail/ }),
    ).toBeVisible();
  });

  test('Gmail account page surfaces an OAuth error from the callback', async ({ page }) => {
    await gotoAuthed(page, '/account/email?error=invalid_state');
    await expect(page.locator('text=invalid_state')).toBeVisible();
  });

  test('Lead detail exposes the email composer', async ({ page }) => {
    await gotoAuthed(page, '/leads');
    const result = await openFirstOrSkip(page, '/leads/', 'leads');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    await expect(page.locator('h2', { hasText: /^Email$/ })).toBeVisible();

    // A lead without an address must say so rather than offer a dead button.
    const draft = page.locator('button', { hasText: /Draft with AI/i });
    const noEmail = page.locator('text=/no email address/i');
    await expect(draft.or(noEmail).first()).toBeVisible();
  });

  test('Composer shows the destination address before drafting', async ({ page }) => {
    await gotoAuthed(page, '/leads');
    const result = await openFirstOrSkip(page, '/leads/', 'leads');
    test.skip(!result.opened, result.opened ? '' : result.reason);

    const draft = page.locator('button', { hasText: /Draft with AI/i });
    test.skip((await draft.count()) === 0, 'This lead has no email address.');

    await expect(page.locator('text=/Sending to .+@.+/')).toBeVisible();
  });
});
