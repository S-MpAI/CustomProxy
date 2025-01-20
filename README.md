# CustomProxy
## Badges
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=S-MpAI_CustomProxy&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=S-MpAI_CustomProxy)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=S-MpAI_CustomProxy&metric=bugs)](https://sonarcloud.io/summary/new_code?id=S-MpAI_CustomProxy)
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/66d8d6e40cab4e72b9e44d7921be602d)](https://app.codacy.com/gh/S-MpAI/CustomProxy/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

[![SonarQube Cloud](https://sonarcloud.io/images/project_badges/sonarcloud-dark.svg)](https://sonarcloud.io/summary/new_code?id=S-MpAI_CustomProxy)
## Code
# init.js
```js
const { root } = require('cheerio');
const HostHandler = require('./func/main');

class Initialize {
    constructor(port, rootSite) {
        this.port = port;
        this.HostHandler = new HostHandler(rootSite);
    }

    async start() {
        await this.HostHandler.initializeBrowser();
        await this.HostHandler.start(this.port);
    }
}

let port = 4000;
let rootSite = `http://localhost:${port}`;
const init = new Initialize(port, rootSite);
init.start();
```

# ./func/main.js
```js
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs'); 
const os = require('os'); 
const cheerio = require('cheerio');
const app = express();
const ip = require('ip');
const { URL } = require('url');

const RoutesM = require('./routes');
const API_KEY = 'your-secret-api-key'; 
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
app.use(express.json());


class HostHandler {
    constructor(rootSite) {
        this.app = express();
        this.rootSite = rootSite;
    }

    routes() {
        this.app.get('/api/screenshot', async (req, res) => {
            this.Routes.screenshot(req, res);
        });

        this.app.get('/api/full_page', async (req, res) => {
            this.Routes.full_page(req, res);
        });


        this.app.get('/api/proxy_handler', async (req, res) => {
            this.Routes.proxy_handler_get(req, res);
        });
        
        this.app.post('/api/proxy_handler', async (req, res) => {
            this.Routes.proxy_handler_post(req, res);
        });
    }

    async start(port) {
        this.Routes = new RoutesM(this.browser, this.rootSite);
        console.log(`[HostHandler][Routes] Успех.`);
        this.routes();
        console.log(`[HostHandler][routes] Успех.`);
        this.app.set('trust proxy', true);
        this.app.listen(port, () => {
            console.log(`[HostHandler][start] Сервер запущен на http://localhost:${port}`);
        });
    }
    

    async initializeBrowser() {
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        console.log('[HostHandler][initializeBrowser] Браузер запущен.');
    }

    async closeBrowser() {
        if (this.browser) {
            await this.browser.close();
            console.log('[HostHandler][initializeBrowser] Браузер закрыт.');
        }
    }
}

module.exports = HostHandler;
```
