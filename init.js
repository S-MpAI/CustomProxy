
const HostHandler = require('./func/main');

class Initialize {
    /**
     * Создает новый экземпляр Initialize.
     * @param {number} port - Порт для прослушивания.
     * @param {string} rootSite - URL корневого сайта.
     */
    constructor(port = 4000, rootSite = `http://localhost:4000`) {
        this.port = port;
        this.rootSite = rootSite;
        this.HostHandler = new HostHandler(this.rootSite);
    }

    /**
     * Запускает процесс инициализации.
     */
    async start() {
        try {
            await this.HostHandler.initializeBrowser();
            await this.HostHandler.start(this.port);
        } catch (error) {
            console.error('Error during initialization:', error);
        }
    }
}

// Определение параметров
const port = 4000;
const rootSite = `http://localhost:${port}`;
const init = new Initialize(port, rootSite);

// Запуск приложения
init.start();
