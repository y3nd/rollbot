const Eris = require("eris");
const DBManager = require("./DBManager");
const Logger = require("./Logger");

const crypto = require("crypto")

class Roll {
  constructor() {
    this.config = {
      token: require("./token"),
      db: {
        name: "roll"
      },
      log: {
        prefix: "rl",
        info: 1,
        warning: 1,
        verbose: 1
      },
      minBet: 5,
      timeout: 1*60*1000,
      bustTimeout: 4*1000,
      dailyStreakBonus: 150,
      dailyBonusMin: 200,
      dailyBonusMax: 500,
      baseBalance: 5000
    }
    this.log = new Logger(this.config);
    this.client = new Eris(this.config.token);
    this.dbManager = new DBManager(this);

    /*for(var i = 0; i<500; i++) {
      console.log(this.getBustParams());
    }*/
  }

  async start() {
    this.db = await this.dbManager.connect();

    this.client.on("ready", () => {
      this.log.info("Ready!");
    });

    this.client.on("messageCreate", (msg) => {
      if(!msg.channel.guild) return;
      if(!msg.author || msg.author.bot) return;
      msg.content = msg.content.toLowerCase();

      var rollMatch = msg.content.match(/^r![ ]*([\d]+|allin)$/);
      var bustMatch = msg.content.match(/^r!b[ ]*([\d]+)$/);

      if(rollMatch) {
        this.handleRoll(msg, rollMatch);
        //bot.createMessage(msg.channel.id, "Pong!");
      } else if(bustMatch) {
        this.handleBust(msg, bustMatch);
      } else if(msg.content.startsWith("r!p")) {
        this.handleProfile(msg);
        //bot.createMessage(msg.channel.id, "Ping!");
      } else if(msg.content.startsWith("r!daily")) {
        this.handleDaily(msg);
        //bot.createMessage(msg.channel.id, "Ping!");
      } else if(msg.content.startsWith("r!top")) {
        this.handleTop(msg);
      } else if(msg.content.startsWith("r!b")) {
        this.client.createMessage(msg.channel.id, "💸 Type r!b <amount> to bet in bustmode\nEx: `r!b 50`");
      } else if(msg.content.startsWith("r!")) {
        this.client.createMessage(msg.channel.id, "💸 Type r! <rollAmount> to roll\nEx: `r! 500`");
      }
    });

    this.client.on("messageReactionAdd", (msg, emoji, userID) => {
      var bust = this.getBust(msg.channel.guild);

      if(bust.status && msg.id == bust.startMessage.id && emoji.name == "🛑") {
        var buster = bust.busters.find(b => b.userID == userID);
        if(!buster) return;
        buster.cashedOut = 1;
        buster.bust = this.getResultFromMS(new Date() - bust.startDate);
        buster.amountWon = Math.round(buster.amount*buster.bust);
        this.client.createMessage(msg.channel.id, `💸 <@${userID}> cashed out **@${buster.bust.toFixed(2)}×** (💵 **${this.largeNumber(buster.amountWon)}**)`);

        bust.notCashedOutCount--;
        //console.log(bust.notCashedOutCount);
        if(bust.notCashedOutCount == 0) {
          clearTimeout(bust.timeout);
          this.client.createMessage(msg.channel.id, "💸 *Auto-bust since all players have cashed out*");
          this.bust(msg.channel);
        }
      }
    })

    this.client.on("error", (e) => {
      console.error(e);
    })

    /*// DEBUG
    this.client.on("rawWS", (e) => {
      console.log(e);
    })*/

    this.log.info(`connecting to discord..`);
    this.client.connect();
  }

  async handleBust(msg, match) {
    var user = await this.getUser(msg.author);

    var amount = parseInt(match[1]);

    if(amount > user.balance || amount < this.minBet) {
      this.client.createMessage(msg.channel.id, `💸 invalid bust`);
      return;
    }

    var bust = this.getBust(msg.channel.guild);

    if(bust.status == 1) {
      this.client.createMessage(msg.channel.id, `💸 bust has already started`);
      return;
    }

    this.updateUserInc(msg.author.id, { gamesPlayed: 1 });

    this.client.createMessage(msg.channel.id, `💸 <@${msg.author.id}> - 💵 **${this.largeNumber(amount)}** in bust`);

    if(bust.busters.length == 0) {
      bust.notCashedOutCount = 0;

      this.client.createMessage(msg.channel.id, `💸 starting bust in **${this.config.bustTimeout/1000}** sec`);

      bust.params = this.getBustParams();

      setTimeout(async () => {
        var m = await this.client.createMessage(msg.channel.id, this.getBustStartMessage(bust));
        m.addReaction(`🛑`);
        bust.startDate = new Date();
        bust.status = 1;
        bust.startMessage = m;
        await m.addReaction(`🛑`);
      }, this.config.bustTimeout);
      bust.timeout = setTimeout(() => {
        this.bust(msg.channel);
      }, this.config.bustTimeout+bust.params.ms);

      bust.interval = setInterval(() => {
        var text = this.getBustStartMessage(bust);
        if(bust.status == 1 && bust.startMessage && bust.startMessage.content !== text) {
          bust.startMessage.edit(text);
        }
      }, 1005);
    }

    bust.notCashedOutCount++;
    bust.busters.push({
      userID: msg.author.id,
      amount: amount,
      amountWon: 0
    });
  }

  getBustStartMessage(bust, end) {
    return `💸 ⚪ **Bust started** ⚪
    \n\n*##*     @**${end ? bust.params.bust.toFixed(2) : this.getResultFromMS(new Date() - bust.startDate).toFixed(2)}×**     *##*
    \n\n###`;
  }

  async bust(channel) {
    var bust = channel.guild.bust;
    bust.status = 0;
    clearInterval(bust.interval);
    if(bust.startMessage) bust.startMessage.edit(this.getBustStartMessage(bust, 1));
    var text = `💸 🛑 **Busted @${bust.params.bust.toFixed(2)}×** 🛑\n`;
    bust.busters.sort((a, b) => a.bust - b.bust);
    for (const buster of bust.busters) {
      text += `\n<@${buster.userID}> - `;

      if(!buster.cashedOut) {
        await this.updateUserInc(buster.userID, {
          gamesLost: 1,
          losses: buster.amount,
          balance: -buster.amount
        });
        text += `*💵 **-${this.largeNumber(buster.amount)}** - LOST*`;
      } else {
        await this.updateUserInc(buster.userID, {
          gamesWon: 1,
          earnings: buster.amountWon,
          balance: buster.amountWon
        });
        text += `@**${buster.bust.toFixed(2)}×** (💵 **${this.largeNumber(buster.amountWon)}**)`;
      }
    }
    text += `\n\n*Game seed:* \`${bust.params.seed}\``;
    this.client.createMessage(channel.id, text);

    channel.guild.bust = { busters: [], status: 0, total: 0 };
  }

  async handleDaily(msg) {
    var user = await this.getUser(msg.author);
    var day = 24*60*60*1000;

    var d = new Date();
    d.setHours(24,0,0,0);

    if(user.lastDaily && d - user.lastDaily < day) {
      this.client.createMessage(msg.channel.id, `💸 Wait tomorrow`);
      return;
    }

    if(!user.dailyStreak) user.dailyStreak = 1;

    var amount = Math.floor((Math.random()*this.config.dailyBonusMax) + this.config.dailyBonusMin + this.config.dailyStreakBonus*user.dailyStreak);

    var d2 = new Date();
    d2.setHours(0, 0, 0, 0);

    var set = {
      lastDaily: new Date(),
      balance: user.balance+amount
    };

    if(user.dailyStreak && d2 - user.lastDaily < day) {
      set.dailyStreak = user.dailyStreak+1;
    } else {
      set.dailyStreak = 1;
    }

    this.updateUser(msg.author.id, set);

    var text = `💸 You've been awarded 💵 **${amount}**`;
    if(set.dailyStreak > 1) text += `\n\nOngoing streak: **${set.dailyStreak}**x${this.config.dailyStreakBonus} = **${set.dailyStreak*this.config.dailyStreakBonus}** streak bonus`;

    this.client.createMessage(msg.channel.id, text);
  }

  async handleRoll(msg, match) {
    var user = await this.getUser(msg.author);

    if(match[1] == "allin") var amount = user.balance;
    else var amount = parseInt(match[1]);

    if(amount > user.balance || amount == 0) {
      this.client.createMessage(msg.channel.id, `💸 invalid roll`);
      return;
    }

    this.log.verbose(`${msg.author.username} just rolled $${amount}`);
    var bankRoll = this.getBankRoll(msg.channel.guild);
    var genericMessage = `💸 <@${msg.author.id}> just rolled 💵 **${this.largeNumber(amount)}**`;
    if(bankRoll.rolls.length !== 0) {
      var userRoll = bankRoll.rolls.find(r => r.userID == msg.author.id);
      if(userRoll) {
        this.log.verbose(`${msg.author.username} has already rolled $${userRoll.amount}`);
        userRoll.amount += amount;
        bankRoll.total += amount;
        this.client.createMessage(msg.channel.id, `${genericMessage} more!\n\n${this.bankRollMessage(bankRoll)}`);
        return;
      }

      if(amount < this.config.minBet || amount > 10e6) {
        this.client.createMessage(msg.channel.id, `💸 invalid roll`);
        return;
      }

      this.updateUserBalance(user.id, -1*amount);

      bankRoll.rolls.push({
        userID: msg.author.id,
        amount: amount
      })

      bankRoll.total += amount;

      var bankRollMessage = this.bankRollMessage(bankRoll);

      this.client.createMessage(msg.channel.id, `${genericMessage}\n${bankRollMessage}`);
    } else {
      if(amount < this.config.minBet || amount > 10e6) {
        this.client.createMessage(msg.channel.id, `💸 invalid roll`);
        return;
      }

      this.updateUserBalance(user.id, -1*amount);

      bankRoll.rolls.push({
        userID: msg.author.id,
        amount: amount
      });

      bankRoll.total += amount;

      setTimeout(() => {
        this.client.createMessage(msg.channel.id, `💸 Rollin' in 30 sec`);
      }, this.config.timeout-30*1000);

      setTimeout(() => {
        this.client.createMessage(msg.channel.id, `💸 Rollin' in 5 sec`);
      }, this.config.timeout-5*1000);

      setTimeout(() => {
        this.roll(msg.channel);
      }, this.config.timeout);
      this.client.createMessage(msg.channel.id, genericMessage);
    }
  }

  bankRollMessage(bankRoll) {
    var message = `\nTotal bank roll: 💵 **${this.largeNumber(bankRoll.total)}**`;
    message += `\n`;

    bankRoll.rolls.forEach(roll => {
      message += `\n<@${roll.userID}> - 💵 **${this.largeNumber(roll.amount)}**`;
      message += ` (${this.formatChance(roll.amount, bankRoll.total)})`;
    })

    return message;
  }

  roll(channel) {
    var bankRoll = channel.guild.bankRoll;

    if(bankRoll.rolls.length < 2) {
      this.updateUserBalance(bankRoll.rolls[0].userID, bankRoll.total);
      this.client.createMessage(channel.id, `💸 Roll has expired`);
    } else {
      var lucky = Math.floor(Math.random() * bankRoll.total);


      var accumulator = 0;
      var winner = null;
      bankRoll.rolls.forEach(roll => {
        //if(winner) return;

        if(lucky >= accumulator && lucky < accumulator+roll.amount) {
          this.log.verbose(`found a winner`);
          winner = roll;
        }

        accumulator += roll.amount;
      })

      var text = `**💸 ROLL 💸**`;
      text += `\nLucky number: **${lucky}**`;
      text += `\n<@${winner.userID}> won 💵 **${this.largeNumber(bankRoll.total)}** with ${this.formatChance(winner.amount, bankRoll.total)} chance rate`;

      this.updateUserBalance(winner.userID, bankRoll.total);

      this.client.createMessage(channel.id, text);
    }

    channel.guild.bankRoll = { rolls: [], total: 0 };
  }

  async getUser(author) {
    var user = await this.db.collection("users").findOne({ id: author.id });
    if(!user) {
      user = {
        id: author.id,
        username: author.username,
        discriminator: author.discriminator,
        discordCreatedAt: author.createdAt,
        createdAt: new Date(),
        avatar: author.avatar,
        balance: this.config.baseBalance,
        losses: 0,
        earnings: 0,
        gamesPlayed: 0
      }
      await this.db.collection("users").insert(user);
    }
    return user
  }

  async updateUser(id, set) {
    await this.db.collection("users").update({ id: id }, { $set: set });
  }

  async updateUserBalance(id, variation) {
    await this.db.collection("users").update({ id: id }, { $inc: { balance: variation }});
  }

  async updateUserInc(id, set) {
    await this.db.collection("users").update({ id: id }, { $inc: set });
  }

  formatChance(amount, total) {
    return `${Math.round((amount/total)*10000)/100}%`;
  }

  async handleProfile(msg) {
    var user = await this.getUser(msg.author);
    var profit = user.earnings-user.losses;
    var embed = {
      title: `💸 **${msg.author.username}** profile 💸`,
      timestamp: new Date(),
      footer: { text: "Rollbot" },
      fields: [
        { name: "Balance", value: `💵 **${this.largeNumber(user.balance)}**`, inline: true },
        { name: "Games played", value: `🕹️ **${this.largeNumber(user.gamesPlayed)}**`, inline: true },
        { name: "Profit",
          value: `${profit>0?`✅`:`🔴`} **${this.largeNumber(profit)}**`,
          inline: true
        },
        { name: "Earnings", value: `🔺 **${this.largeNumber(user.earnings)}**`, inline: true },
        { name: "Losses", value: `🔻 **${this.largeNumber(user.losses)}**`, inline: true },
        { name: "-", value: `-`, inline: true }
      ]
    }
    this.client.createMessage(msg.channel.id, { embed });
  }

  getBankRoll(guild) {
    if(guild.bankRoll !== undefined) return guild.bankRoll;
    else {
      guild.bankRoll = { rolls: [], total: 0 };
      return guild.bankRoll;
    }
  }

  getBust(guild) {
    if(guild.bust!== undefined) return guild.bust;
    else {
      guild.bust = { busters: [], status: 0, total: 0 };
      return guild.bust;
    }
  }

  getBustParams() {
    const hash = crypto.createHash("sha256");
    var d = new Date();
    hash.update(d.toString()+Math.floor(Math.random()*1000));
    var seed = hash.digest("base64");
    var result = this.gameResult(seed, "llortob");
    return { ms: this.getMSFromResult(result), bust: result, seed: seed };
  }

  getMSFromResult(result) {
    //if(ms < 1000) ms = 1000;
    return Math.floor(Math.pow(result-1, 0.35)*5000);
  }

  getResultFromMS(ms) {
    //if(ms < 1000) ms = 1000;
    return Math.floor((Math.pow(ms/5000, 1/0.35)+1)*100)/100 || 1;
  }

  async handleTop(msg) {
    var richest = await this.db.collection("users").find().sort({ balance: -1 }).limit(20).toArray();
    var text = `**💸 Top 20 richest 💸**\n`;

    richest.forEach((user, i) => {
      text += `\n${i+1}. ${user.username} (💵 ${this.largeNumber(user.balance)})`;
    })

    this.client.createMessage(msg.channel.id, text);
  }

  largeNumber(number) {
    var SI_SYMBOL = ["", "k", "M", "G", "T", "P", "E"];
    // what tier? (determines SI symbol)
    var tier = Math.log10(number) / 3 | 0;

    // if zero, we don't need a suffix
    if(tier == 0) return number;

    // get suffix and determine scale
    var suffix = SI_SYMBOL[tier];
    var scale = Math.pow(10, tier * 3);

    // scale the number
    var scaled = number / scale;

    // format number and add suffix
    return scaled.toFixed(1) + suffix;
  }

  gameResult(seed, salt) {
    const nBits = 52 // number of most significant bits to use

    // 1. HMAC_SHA256(key=salt, message=seed)
    const hmac = crypto.createHmac("sha256", salt)
    hmac.update(seed)
    seed = hmac.digest("hex")

    // 2. r = 52 most significant bits
    seed = seed.slice(0, nBits/4)
    const r = parseInt(seed, 16)

    // 3. X = r / 2^52
    let X = r / Math.pow(2, nBits) // uniformly distributed in [0; 1)

      // 4. X = 99 / (1-X)
      X = 99 / (1 - X)

      // 5. return max(trunc(X), 100)
      const result = Math.floor(X)
      return Math.max(1, result / 100)
    }
}

var rl = new Roll();
rl.start();
