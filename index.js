const TelegramBot = require('node-telegram-bot-api');
const { chromium } = require('playwright');

const TOKEN = '8900784629:AAF6stVQep2AFOccsvUtqBxyU5iZknoshB8';

const bot = new TelegramBot(TOKEN, {
    polling: true
});

bot.onText(/\/benzina/, async (msg) => {

    const chatId = msg.chat.id;

    try {

        const browser = await chromium.launch({
            headless: true
        });

        const page = await browser.newPage();

        await page.goto(
            'https://www.komparing.com/es/precio-gasolina-95/illes-balears/palma-de-mallorca',
            {
                waitUntil: 'networkidle'
            }
        );

        // Esperam que aparegui la taula
        await page.waitForSelector('table tbody tr');

        const benzineres = await page.$$eval(
            'table tbody tr',
            rows => {

                return rows.map(row => {

                    const cols = row.querySelectorAll('td');

                    if (cols.length < 2) {
                        return null;
                    }

                    const nom = cols[0].innerText.trim();

                    const preuText = cols[1]
                        .innerText
                        .replace('€', '')
                        .replace(',', '.')
                        .trim();

                    const preu = parseFloat(preuText);

                    if (isNaN(preu)) {
                        return null;
                    }

                    return {
                        nom,
                        preu
                    };
                }).filter(Boolean);
            }
        );

        await browser.close();

        benzineres.sort((a, b) => a.preu - b.preu);

        const top5 = benzineres.slice(0, 5);

        let resposta = '⛽ TOP 5 benzineres més barates\n\n';

        top5.forEach((b, index) => {

            resposta += `${index + 1}. ${b.nom} - ${b.preu}€\n`;

        });

        await bot.sendMessage(chatId, resposta);

    } catch (error) {

        console.error(error);

        await bot.sendMessage(
            chatId,
            'Error obtenint preus'
        );
    }
});