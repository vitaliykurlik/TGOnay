const { Telegraf, session } = require('telegraf');
const QRCode = require('qrcode');
const { createCanvas, CanvasRenderingContext2D } = require('canvas');
const { format } = require('date-fns');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Добавляем middleware для сессий
bot.use(session());

// === БАЗА ДАННЫХ (JSON файл) ===
const DB_PATH = path.join(__dirname, 'subscriptions.json');

// Загрузка базы
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Ошибка загрузки БД:', e);
  }
  return {};
}

// Сохранение базы
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// Инициализация
let subscriptions = loadDB();

const validRoutes = ['1','2','3','4','5','7','10','11','12','15','18','22','28','29','30','34','38','44','50','56','62','65','70','77','79','86','99','201','202','203','204','205','206','207','208','209','210'];

// ID админа (замени на свой Telegram ID)
const ADMIN_ID = process.env.ADMIN_ID || '';

// Расширение для закруглённых углов
CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  this.beginPath();
  this.moveTo(x + r, y);
  this.arcTo(x + w, y, x + w, y + h, r);
  this.arcTo(x + w, y + h, x, y + h, r);
  this.arcTo(x, y + h, x, y, r);
  this.arcTo(x, y, x + w, y, r);
  this.closePath();
  return this;
};

// Главное меню
bot.start((ctx) => ctx.reply('Добро пожаловать в ONAY Pass!\nВыберите действие:', {
  reply_markup: {
    keyboard: [['Купить подписку', 'Сгенерировать билет']],
    resize_keyboard: true
  }
}));

// Функция показа главного меню
function showMainMenu(ctx, text = 'Выберите действие:') {
  ctx.session = {};
  return ctx.reply(text, {
    reply_markup: {
      keyboard: [['Купить подписку', 'Сгенерировать билет']],
      resize_keyboard: true
    }
  });
}

// Купить подписку
bot.hears('Купить подписку', (ctx) => {
  const code = 'ONAY-' + Math.random().toString(36).substring(2, 10).toUpperCase();
  const userId = ctx.from.id;
  subscriptions[code] = { 
    trips_left: 0, 
    activated: false,
    userId: userId,
    createdAt: new Date().toISOString()
  };
  saveDB(subscriptions);
  ctx.reply(`Ваш уникальный код: *${code}*\n\nДля покупки переведите на Kaspi Gold:\nНомер: +7 (XXX) XXX-XX-XX\nВ комментарии обязательно укажите: ${code}\n\nТарифы:\n• 20 поездок — 500 тг\n• 50 поездок — 1000 тг\n• 100 поездок — 1500 тг\n\nПосле перевода напишите @ezkey — активирую подписку!`, { parse_mode: 'Markdown' });
});

// === АДМИН КОМАНДЫ ===
// Активация подписки: /activate ONAY-XXXXXX 20
bot.command('activate', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Нет доступа');
  }
  
  const args = ctx.message.text.split(' ');
  if (args.length < 3) {
    return ctx.reply('Использование: /activate КОД ПОЕЗДКИ\nПример: /activate ONAY-ABC123 20');
  }
  
  const code = args[1].toUpperCase();
  const trips = parseInt(args[2]);
  
  if (!subscriptions[code]) {
    return ctx.reply(`❌ Код ${code} не найден в базе`);
  }
  
  if (isNaN(trips) || trips <= 0) {
    return ctx.reply('❌ Укажите корректное количество поездок');
  }
  
  subscriptions[code].trips_left += trips;
  subscriptions[code].activated = true;
  subscriptions[code].activatedAt = new Date().toISOString();
  saveDB(subscriptions);
  
  ctx.reply(`✅ Подписка ${code} активирована!\nПоездок: ${subscriptions[code].trips_left}`);
});

// Просмотр всех подписок: /list
bot.command('list', (ctx) => {
  if (ADMIN_ID && ctx.from.id.toString() !== ADMIN_ID) {
    return ctx.reply('❌ Нет доступа');
  }
  
  const codes = Object.keys(subscriptions);
  if (codes.length === 0) {
    return ctx.reply('База пуста');
  }
  
  let text = '📋 *Все подписки:*\n\n';
  codes.forEach(code => {
    const sub = subscriptions[code];
    const status = sub.activated ? '✅' : '⏳';
    text += `${status} \`${code}\` — ${sub.trips_left} поездок\n`;
  });
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Проверка кода: /check ONAY-XXXXXX
bot.command('check', (ctx) => {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    return ctx.reply('Использование: /check КОД');
  }
  
  const code = args[1].toUpperCase();
  const sub = subscriptions[code];
  
  if (!sub) {
    return ctx.reply(`❌ Код ${code} не найден`);
  }
  
  const status = sub.activated ? '✅ Активна' : '⏳ Ожидает оплаты';
  ctx.reply(`📍 Подписка: ${code}\nСтатус: ${status}\nПоездок осталось: ${sub.trips_left}`);
});

// Сгенерировать билет
bot.hears('Сгенерировать билет', (ctx) => {
  ctx.reply('Введите код подписки (ONAY-XXXXXX):');
  ctx.session = { step: 'wait_code' };
});

// Логика ввода
bot.on('text', async (ctx) => {
  if (!ctx.session) ctx.session = {};

  if (ctx.session.step === 'wait_code') {
    const code = ctx.message.text.trim().toUpperCase();
    const sub = subscriptions[code];
    
    // Проверка валидности кода
    if (!sub) {
      return showMainMenu(ctx, '❌ Код не найден. Попробуйте снова или купите подписку.');
    }
    if (!sub.activated) {
      return showMainMenu(ctx, '⏳ Подписка ещё не активирована. Ожидайте подтверждения оплаты.');
    }
    if (sub.trips_left <= 0) {
      return showMainMenu(ctx, '❌ Поездки закончились. Купите новую подписку.');
    }
    
    // Код валидный — продолжаем
    ctx.session.code = code;
    ctx.session.step = 'wait_route';
    return ctx.reply(`✅ Код принят! Осталось поездок: ${sub.trips_left}\n\nВведите номер маршрута (например, 201):`);
  }

  if (ctx.session.step === 'wait_route') {
    const route = ctx.message.text.trim();
    if (!validRoutes.includes(route)) {
      return ctx.reply('❌ Недопустимый номер маршрута. Попробуйте ещё раз:');
    }
    ctx.session.route = route;
    ctx.session.step = 'wait_qr';
    return ctx.reply('Введите 7-значный код QR (только цифры):');
  }

  if (ctx.session.step === 'wait_qr') {
    const qrCode = ctx.message.text.trim();
    if (qrCode.length !== 7 || !/^\d+$/.test(qrCode)) {
      return ctx.reply('❌ Код QR должен быть ровно 7 цифр. Попробуйте ещё раз:');
    }

    const code = ctx.session.code;
    subscriptions[code].trips_left -= 1;
    saveDB(subscriptions);

    // Генерация случайных кодов
    const routeCode = Math.random().toString(36).substring(2, 9).toUpperCase();
    const verificationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    // Создание билета
    const canvas = createCanvas(600, 950);
    const c = canvas.getContext('2d');

    // Фиолетовый градиент
    const gradient = c.createLinearGradient(0, 0, 0, 950);
    gradient.addColorStop(0, '#E9D5FF');
    gradient.addColorStop(1, '#C4B5FD');
    c.fillStyle = gradient;
    c.fillRect(0, 0, 600, 950);

    // Белая карточка
    c.fillStyle = '#FAF5FF';
    c.roundRect(30, 30, 540, 890, 40);
    c.fill();

    // Сегодня
    c.font = 'bold 42px Arial';
    c.fillStyle = '#6B21A8';
    c.textAlign = 'center';
    c.fillText('Сегодня', 300, 100);

    // Маршрут + код
    c.font = 'bold 52px Arial';
    c.fillStyle = '#1E3A8A';
    c.textAlign = 'left';
    c.fillText('🚍 ' + ctx.session.route + 'E', 60, 220);
    c.fillStyle = '#9333EA';
    c.fillText(routeCode, 360, 220);

    // Время
    c.font = 'bold 48px Arial';
    c.fillStyle = '#1E3A8A';
    c.fillText(format(new Date(), 'dd.MM.yyyy'), 60, 320);
    c.fillText(format(new Date(), 'HH:mm'), 380, 320);

    // Код проверки
    c.font = '30px Arial';
    c.fillStyle = '#6B21A8';
    c.textAlign = 'center';
    c.fillText('Код проверки:', 300, 420);
    c.font = 'bold 58px Arial';
    c.fillStyle = '#1D4ED8';
    c.fillText(verificationCode, 300, 490);

    // QR
    const qrData = await QRCode.toDataURL(qrCode);
    const img = new Image();
    img.src = qrData;
    img.onload = () => {
      c.drawImage(img, 100, 540, 400, 400);
      const buffer = canvas.toBuffer('image/png');
      ctx.replyWithPhoto({ source: buffer }, { caption: `✅ Билет сгенерирован!\nОсталось поездок: ${subscriptions[code].trips_left}\nДействует 30 мин` });
      showMainMenu(ctx);
    };

    ctx.session = {};
  }
});

bot.launch();
console.log('Бот запущен — готов к доходу');