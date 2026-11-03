/**
 * @fileoverview Carga, configuración y autenticación del sistema de control del navegador (Playwright).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const config = require('../config/env');
const logger = require('../utils/logger');
const { isAllowedResource } = require('./reportAccess');

class BrowserManager {
  constructor() {
    this.logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(this.logsDir)) fs.mkdirSync(this.logsDir, { recursive: true });
  }

  async initBrowser(headless = true) {
    logger.info(`Iniciando navegador (headless: ${headless})`);
    return await chromium.launch({ 
      headless,
      args: []
    });
  }

  async configureContext(context) {
    context.setDefaultTimeout(15_000);
    await context.route('**/*', route => isAllowedResource(route.request().url())
      ? route.continue() : route.abort());
  }

  async login(page) {
    if (!config.syslab.user || !config.syslab.pass) throw new Error('Faltan las credenciales locales de Syslab.');
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
      
      if (await page.locator('input[type="password"]').count()) throw new Error('Sesión no iniciada.');
      const errorMsg = await page.innerText('body');
      if (errorMsg.toLowerCase().includes('incorrecto') || errorMsg.toLowerCase().includes('error')) {
        throw new Error('Syslab rechazó el inicio de sesión.');
      }
    } catch (e) {
      logger.warn('Falló el inicio de sesión de Syslab.');
      throw new Error('No se pudo iniciar sesión en Syslab. Comprueba las credenciales y la red local.');
    }
  }
}

module.exports = new BrowserManager();
