import { test, expect } from './fixtures';
import { gotoAuthed, skipWithoutCredentials } from './helpers';
import { es } from '../../src/lib/i18n/dictionaries/es';

const L = es.contactList;

skipWithoutCredentials();

/**
 * The WhatsApp shortcut beside a phone number in the /contacts list
 * (contact-whatsapp-access, variant A). Read-only: it only navigates and
 * inspects links. Assertions hold for ANY data (production drifts): whatever
 * shortcuts the page shows must be well-formed, and must never be the only
 * thing in a cell, since the call link always comes first.
 */
test.describe('Contacts: WhatsApp shortcut in the phone column', () => {
  test('every shortcut is a digits-only wa.me link that opens in a new tab and sits next to a tel: link', async ({
    page,
  }) => {
    await gotoAuthed(page, '/contacts?columns=phone');
    const shortcuts = page.locator('tbody .phone-cell .wa-btn');
    test.skip((await shortcuts.count()) === 0, 'No row on this page has a number with a country code.');

    for (const link of await shortcuts.all()) {
      await expect(link).toHaveAttribute('href', /^https:\/\/wa\.me\/[1-9]\d{7,14}$/);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('title', L.whatsappTitle);
      await expect(link).toHaveAttribute('aria-label', new RegExp(`^${L.whatsappLabelPrefix} \\S`));
      await expect(link.locator('xpath=preceding-sibling::a[starts-with(@href, "tel:")]')).toHaveCount(1);
    }
  });

  test('a number without a country code keeps the call link and gets no shortcut', async ({ page }) => {
    await gotoAuthed(page, '/contacts?columns=phone');
    const cells = page.locator('tbody .phone-cell');
    test.skip((await cells.count()) === 0, 'No row on this page has a phone.');

    for (const cell of await cells.all()) {
      const tel = cell.locator('a[href^="tel:"]');
      if ((await tel.count()) === 0) continue;
      const href = (await tel.getAttribute('href')) ?? '';
      const international = href.startsWith('tel:+') || href.startsWith('tel:00');
      // International-looking numbers may still lack a shortcut (more than 15
      // digits, a "(0)" trunk digit), so only the domestic side is exact.
      if (!international) await expect(cell.locator('.wa-btn')).toHaveCount(0);
    }
  });
});
