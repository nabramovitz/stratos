import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * The product serves its pages under a CSP whose style-src is nonce-based
 * (a per-response nonce minted by the backend). The preview shim injects
 * <style> elements into pages that are captured product DOM, so every one
 * of those injections must carry the host page's nonce or the browser
 * silently drops it. This suite hosts the shim inside a document that
 * really enforces such a policy (CSP <meta>) and asserts the injected
 * styles take effect — with a positive control proving enforcement is on.
 */
const NONCE = 'stb-test-nonce';

function frameHtml(): string {
  return (
    '<!doctype html><html><head>' +
    `<meta http-equiv="Content-Security-Policy" content="style-src 'nonce-${NONCE}'; script-src 'nonce-${NONCE}'">` +
    '</head><body><p id="probe">probe</p>' +
    `<script nonce="${NONCE}" src="/preview-shim.js"></script>` +
    '</body></html>'
  );
}

function mountCspFrame(): Promise<HTMLIFrameElement> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('style', 'width:400px;height:300px');
  iframe.srcdoc = frameHtml();
  const ready = new Promise<HTMLIFrameElement>((resolve) => {
    function listen(e: MessageEvent) {
      if (e.data?.type === 'STB_PREVIEW_READY') {
        window.removeEventListener('message', listen);
        resolve(iframe);
      }
    }
    window.addEventListener('message', listen);
  });
  document.body.appendChild(iframe);
  return ready;
}

const settle = () => new Promise((r) => setTimeout(r, 100));

describe('preview shim under a nonce-enforcing CSP', () => {
  let iframe: HTMLIFrameElement;

  beforeEach(async () => {
    iframe = await mountCspFrame();
  });

  afterEach(() => {
    iframe.remove();
  });

  it('positive control: an un-nonced <style> is blocked by the frame CSP', async () => {
    const doc = iframe.contentDocument!;
    const rogue = doc.createElement('style');
    rogue.textContent = '#probe { color: rgb(255, 0, 255); }';
    doc.head.appendChild(rogue);
    await settle();
    const probe = doc.getElementById('probe')!;
    expect(getComputedStyle(probe).color).not.toBe('rgb(255, 0, 255)');
  });

  it('STB_APPLY_VARS styles survive the CSP', async () => {
    iframe.contentWindow!.postMessage(
      { type: 'STB_APPLY_VARS', root: { '--stb-csp-check': 'rgb(255, 0, 0)' }, dark: {} },
      '*',
    );
    await settle();
    const doc = iframe.contentDocument!;
    const varStyle = doc.getElementById('stb-root-vars')!;
    expect(varStyle.nonce).toBe(NONCE);
    expect(
      getComputedStyle(doc.documentElement).getPropertyValue('--stb-csp-check').trim(),
    ).toBe('rgb(255, 0, 0)');
  });

  it('STB_APPLY_BLOCKS styles survive the CSP', async () => {
    iframe.contentWindow!.postMessage(
      { type: 'STB_APPLY_BLOCKS', css: '#probe { color: rgb(0, 128, 0); }' },
      '*',
    );
    await settle();
    const doc = iframe.contentDocument!;
    const probe = doc.getElementById('probe')!;
    expect(getComputedStyle(probe).color).toBe('rgb(0, 128, 0)');
  });
});
