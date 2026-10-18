/**
 * Content script on the CRM origin. It only tells the CRM's Cuenta > Herramientas card that the extension is
 * installed, by setting `data-crm-extension="<version>"` on <html>. It reads nothing from the page.
 */
document.documentElement.setAttribute("data-crm-extension", chrome.runtime.getManifest().version);
