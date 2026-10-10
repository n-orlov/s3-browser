import { test, expect, TEST_BUCKETS, getEndpoint } from './electron-fixtures';
import { getLocalStackS3Client } from './fixtures/localstack-setup';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const SEEDED_KEY = 'documents/monaco-offline.txt';
const SEEDED_CONTENT = 'monaco renders offline with zero egress';

test.describe('Monaco editor without external egress', () => {
  test.beforeAll(async () => {
    await getLocalStackS3Client().send(new PutObjectCommand({
      Bucket: TEST_BUCKETS.main,
      Key: SEEDED_KEY,
      Body: SEEDED_CONTENT,
      ContentType: 'text/plain',
    }));
  });

  test.afterAll(async () => {
    await getLocalStackS3Client().send(new DeleteObjectCommand({
      Bucket: TEST_BUCKETS.main,
      Key: SEEDED_KEY,
    }));
  });

  test('renders the editor and the file content when every non-LocalStack request is aborted', async ({ electronApp, window }) => {
    const localStackHost = new URL(getEndpoint()).host;
    const abortedUrls: string[] = [];

    await electronApp.context().route('**/*', async (route) => {
      const { protocol, host } = new URL(route.request().url());
      if (protocol === 'file:' || host === localStackHost) {
        await route.continue();
        return;
      }
      abortedUrls.push(route.request().url());
      await route.abort();
    });

    // Prove the route is live: a hidden window loading a foreign URL must be
    // aborted and recorded (the renderer's CSP would stop a probe from the page).
    const probeUrl = 'http://egress-probe.invalid/';
    await electronApp.evaluate(({ BrowserWindow }, url) => {
      const probe = new BrowserWindow({ show: false });
      probe.loadURL(url).catch(() => undefined);
    }, probeUrl);
    await expect.poll(() => abortedUrls).toContain(probeUrl);
    abortedUrls.length = 0;

    // Reload so that every renderer request, including the bundled Monaco
    // assets, goes through the route installed above.
    await window.reload();
    await expect(window.locator('.app')).toBeVisible();

    await window.locator('.profile-dropdown').selectOption('test');
    const mainBucket = window.locator('.bucket-item').filter({ hasText: TEST_BUCKETS.main });
    await expect(mainBucket).toBeVisible();
    await mainBucket.click();

    await window.locator('.file-row.folder').filter({ hasText: 'documents' }).dblclick();
    await window.locator('.file-row.file').filter({ hasText: 'monaco-offline.txt' }).click();
    await window.locator('button[title="Edit file as text"]').click();

    const monacoEditor = window.locator('.text-editor-overlay .monaco-editor');
    await expect(monacoEditor).toBeVisible();
    await expect(monacoEditor).toContainText(SEEDED_CONTENT);

    expect(abortedUrls, `aborted requests: ${abortedUrls.join(', ')}`).toEqual([]);
  });
});
