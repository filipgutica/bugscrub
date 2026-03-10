import { test, expect } from '@playwright/test'

test.describe('settings surface', () => {
  test('should filter settings list', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByTestId('settings-results-table')).toBeVisible()
  })
})
