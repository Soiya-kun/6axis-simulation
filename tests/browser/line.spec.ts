import { test, expect } from '@playwright/test';

test('line animation, pause, scan step, live faults and reset behave consistently', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#line');
  await expect(
    page.getByRole('heading', { name: '製造ラインシミュレーション LINE 01' }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /^製造ライン俯瞰図/ })).toBeVisible();
  await page.getByRole('button', { name: '1スキャン進める', exact: true }).click();
  await expect(page.getByTestId('line-clock')).toContainText('0.02');
  await page.getByRole('button', { name: 'ラインを開始', exact: true }).click();
  await expect
    .poll(async () => Number((await page.getByTestId('line-clock').innerText()).replace('s', '')))
    .toBeGreaterThan(0.15);
  await page.getByRole('button', { name: 'ラインを一時停止', exact: true }).click();
  const paused = await page.getByTestId('line-clock').innerText();
  await page.waitForTimeout(150);
  await expect(page.getByTestId('line-clock')).toHaveText(paused);
  await page.getByRole('button', { name: '搬出を閉塞する', exact: true }).click();
  await expect(page.getByRole('button', { name: '搬出閉塞を解除' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '非常停止', exact: true }).click();
  await expect(page.getByTestId('line-status')).toContainText('NG');
  await expect(page.getByText('EMERGENCY_STOP · 非常停止が押されました')).toBeVisible();
  await page.getByRole('button', { name: 'ラインをリセット', exact: true }).click();
  await expect(page.getByTestId('line-clock')).toHaveText('0.00s');
  await expect(page.getByRole('button', { name: '搬出を閉塞する', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.locator('summary').filter({ hasText: 'PLC・信号・監視' }).click();
  await page.getByRole('spinbutton', { name: 'PLCスキャン周期', exact: true }).fill('0.015');
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '1スキャン進める', exact: true }).click();
  }
  await expect(page.getByTestId('line-clock')).toHaveText('0.06s');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

test('batch validation compares real standard, shortened and failing configurations', async ({
  page,
}) => {
  await page.goto('/#line');
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row')).toHaveCount(1);
  await expect(page.getByTestId('trial-row').first()).toContainText('OK');
  await expect(page.getByTestId('trial-row').first()).toContainText('121.48');
  await page.getByRole('tab', { name: '実験プリセット' }).click();
  await page.getByRole('button', { name: /タクトを短縮/ }).click();
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row')).toHaveCount(2);
  await expect(page.getByTestId('trial-row').first()).toContainText('MISSION CLEAR');
  await page.getByRole('button', { name: /停止待ち不足/ }).click();
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row')).toHaveCount(3);
  await expect(page.getByTestId('trial-row').first()).toContainText('CLAMP_WHILE_MOVING');
  await expect(page.getByText('停止する前にロボットが進入', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'パラメーター' }).click();
  await page.getByRole('spinbutton', { name: '停止後の開始待ち', exact: true }).fill('0.85');
  await expect(page.getByText(/設定が変更されています。開始/)).toBeVisible();
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row')).toHaveCount(4);
  await expect(page.getByTestId('trial-row').first()).toContainText('OK');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '実験1の結果を保存', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('line-result.json');
});

test('line config imports, validates, persists and the original simulator stays accessible', async ({
  page,
}) => {
  await page.goto('/#line');
  await page.getByRole('spinbutton', { name: '検品時間', exact: true }).fill('0');
  await expect(page.getByRole('alert')).toContainText('検品時間');
  await expect(page.getByRole('button', { name: '一括検証', exact: true })).toBeDisabled();
  await page.getByRole('spinbutton', { name: '検品時間', exact: true }).fill('1.25');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  const path = await (await downloaded).path();
  await page.getByRole('spinbutton', { name: '検品時間', exact: true }).fill('2');
  await page.locator('input[type=file]').setInputFiles(path!);
  await expect(page.getByRole('spinbutton', { name: '検品時間', exact: true })).toHaveValue('1.25');
  await page.reload();
  await expect(page.getByRole('spinbutton', { name: '検品時間', exact: true })).toHaveValue('1.25');
  await page.getByRole('link', { name: 'ロボット軌道', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('link', { name: '製造ライン', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: '検品時間', exact: true })).toHaveValue('1.25');
});

test('overfeeding stops the animated line and batch verification with an actionable overflow', async ({
  page,
}) => {
  await page.goto('/#line');
  await page.getByRole('tab', { name: '実験プリセット' }).click();
  await page.getByRole('button', { name: /供給過多/ }).click();
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row').first()).toContainText('INPUT_OVERFLOW');
  await expect(page.getByTestId('trial-row').first()).toContainText('18.01');
  await page.getByRole('combobox', { name: 'ライン再生速度' }).selectOption('10');
  await page.getByRole('button', { name: 'ラインを開始', exact: true }).click();
  await expect(page.getByTestId('line-status')).toContainText('NG', { timeout: 10000 });
  await expect(page.getByTestId('line-clock')).toHaveText('18.01s');
  await expect(page.getByText('供給過多 / あふれ停止', { exact: true })).toBeVisible();
  await expect(
    page.getByText('INPUT_OVERFLOW · 供給過多で搬入バッファがあふれました'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '1スキャン進める', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: 'パラメーター' }).click();
  await page.getByRole('spinbutton', { name: 'ワーク供給間隔', exact: true }).fill('10');
  await page.getByRole('button', { name: '一括検証', exact: true }).click();
  await expect(page.getByTestId('trial-row')).toHaveCount(2);
  await expect(page.getByTestId('trial-row').first()).toContainText('OK');
});
