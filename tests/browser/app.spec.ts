import { test, expect } from '@playwright/test';

test('renders 3D, plays, seeks, exports, and has no horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  expect(
    await page
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) => !!canvas.getContext('webgl2')),
  ).toBe(true);
  await page.getByRole('button', { name: '再生', exact: true }).click();
  await expect(page.getByRole('button', { name: '一時停止', exact: true })).toBeVisible();
  await expect
    .poll(async () => Number(await page.getByRole('slider', { name: '再生時刻' }).inputValue()))
    .toBeGreaterThan(0.1);
  await page.getByRole('button', { name: '一時停止', exact: true }).click();
  await page.getByRole('slider', { name: '再生時刻' }).fill('4');
  await expect(page.locator('.time-display>b')).toHaveText('4.00s');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('axis-trajectory.csv');
  await page.getByRole('button', { name: '検証結果', exact: true }).click();
  await expect(page.getByText('全サンプルとフレーム間の領域検証を通過')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('link dimensions, workspace NG and sphere mode affect the real simulation', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'J2 長さ', exact: true }).fill('350');
  await page.getByRole('spinbutton', { name: 'J2 長さ', exact: true }).blur();
  await expect(page.getByText('設定が変更されています')).toBeVisible();
  await expect(page.getByRole('button', { name: '再生', exact: true })).toBeDisabled();
  await page
    .getByRole('navigation', { name: '設定カテゴリ' })
    .getByRole('button', { name: '稼働領域', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: 'Z 最小', exact: true }).fill('0');
  await page.getByRole('spinbutton', { name: 'Z 最小', exact: true }).blur();
  await page.getByRole('button', { name: '軌道を計算', exact: false }).click();
  await expect(page.getByText('NG あり', { exact: true })).toBeVisible();
  await expect(page.getByText('稼働領域から逸脱', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '検証結果', exact: false }).click();
  await expect(page.getByText('軌道を実行できない箇所があります')).toBeVisible();
  await page.getByRole('button', { name: '球 Bounding sphere' }).click();
  await page.getByRole('button', { name: '軌道を計算', exact: false }).click();
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'J2 長さ', exact: true })).toHaveValue('350');
});
test('invalid function is actionable and saved settings round-trip', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '軌道関数', exact: true }).click();
  await page.getByRole('textbox', { name: 'x(t)', exact: true }).fill('unknown(t)');
  await page.getByRole('button', { name: '軌道を計算', exact: false }).click();
  await expect(page.getByRole('alert')).toContainText('使用できない');
  await page.getByRole('textbox', { name: 'x(t)', exact: true }).fill('520');
  await page.getByRole('button', { name: '軌道を計算', exact: false }).click();
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  const path = await (await saved).path();
  expect(path).toBeTruthy();
  await page.getByRole('textbox', { name: 'x(t)', exact: true }).fill('4000');
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('textbox', { name: 'x(t)', exact: true })).toHaveValue('520');
  await expect(page.getByText('検証済み', { exact: true })).toBeVisible();
});
