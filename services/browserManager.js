/**
 * @fileoverview Carga, configuración y autenticación del sistema de control del navegador (Playwright).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const logger = require('../utils/logger');

class BrowserManager {
  constructor() {
    this.logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true });
  }

  async initBrowser(headless = true) {
    logger.info(`Iniciando navegador (headless: ${headless})`);
    return await chromium.launch({ 
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
    });
  }

  async login(page) {
    try {
      logger.info('Intentando login en Syslab...');
      const userInput = page.locator('input[name="usuario"], input[type="text"]').first();
      const passInput = page.locator('input[name="password"], input[type="password"]').first();
      
      await userInput.waitFor({ state: 'visible', timeout: 10000 });
      await userInput.fill(config.syslab.user);
      await passInput.fill(config.syslab.pass);
      
      const loginBtn = page.locator('input[value="Ingresar"], button:has-text("Ingresar"), input[type="submit"]').first();
      await loginBtn.click();
      
      await page.waitForLoadState('networkidle');
      
      const errorMsg = await page.innerText('body');
      if (errorMsg.toLowerCase().includes('incorrecto') || errorMsg.toLowerCase().includes('error')) {
        logger.warn('Posible error de credenciales detectado en Syslab.');
      }
    } catch (e) {
      logger.error(`Falla en Login: ${e.message}`);
      await page.screenshot({ path: path.join(this.logsDir, `login_error_${Date.now()}.png`) });
      throw new Error(`Falla en Login: ${e.message}`);
    }
  }
}

module.exports = new BrowserManager();
