async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.getByText('控制台已就绪。总开关默认关闭，调整设置不会自动接管客户端。').waitFor();
  assert(await page.getByRole('switch').count() === 1, 'one core switch');
  assert(await page.getByRole('checkbox').count() === 9, 'nine optional protections');
  assert(await page.getByRole('radio').count() === 3, 'three cleanup modes');
  const revision = async () => Number((await page.locator('#revision').textContent()).match(/\d+$/)[0]);
  const rate = page.getByRole('checkbox', {name: /临时限流/});
  const before = await rate.isChecked(), version = await revision();
  await rate.click();
  await page.waitForFunction(value => Number(document.getElementById('revision').textContent.match(/\d+$/)[0]) > value, version);
  await page.reload();
  await page.getByText('控制台已就绪。总开关默认关闭，调整设置不会自动接管客户端。').waitFor();
  assert(await rate.isChecked() !== before, 'checkbox must persist after reload');
  const port = page.getByRole('spinbutton', {name: '过滤端口'}), saved = await port.inputValue();
  await port.fill('1');
  await page.getByRole('button', {name: '保存接入设置'}).click();
  assert(!await port.evaluate(input => input.validity.valid), 'invalid port must be rejected');
  await port.fill(saved);
  await page.setViewportSize({width: 390, height: 844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile horizontal overflow');
  await page.setViewportSize({width: 1440, height: 1000});
  return {checkboxPersistence: true, invalidPortBlocked: true, mobileLayout: true};
}
