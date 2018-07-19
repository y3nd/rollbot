const Eris = require("eris");
const DBManager = require("./DBManager");
const Logger = require("./Logger");

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
      baseBalance: 2500
    }
    this.log = new Logger(this.config);
    this.client = new Eris(this.config.token);
    this.dbManager = new DBManager(this);

    for(var i = 0; i<500; i++) {
      console.log(this.getBustParams());
    }
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
      } else if(msg.content.startsWith("r!c")) {
        this.handleCredits(msg);
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
        buster.bust = this.getBustFromMS(new Date() - bust.startDate);
        buster.amountWon = Math.round(buster.amount*buster.bust);
        this.updateUserBalance(buster.userID, buster.amountWon);
        this.client.createMessage(msg.channel.id, `💸 <@${userID}> cashed out **@${buster.bust}×** (💵 **${this.largeNumber(buster.amountWon)}**)`);
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

    this.updateUserBalance(user.id, -1*amount);

    this.client.createMessage(msg.channel.id, `💸 <@${msg.author.id}> - 💵 **${this.largeNumber(amount)}** in bust`);

    if(bust.busters.length == 0) {
      this.client.createMessage(msg.channel.id, `💸 starting bust in **${this.config.bustTimeout/1000}** sec`);

      bust.params = this.getBustParams();

      setTimeout(async () => {
        var m = await this.client.createMessage(msg.channel.id, `💸 ⚪ **Bust started** ⚪`);
        m.addReaction(`🛑`);
        bust.startDate = new Date();
        bust.status = 1;
        bust.startMessage = m;
      }, this.config.bustTimeout);
      setTimeout(() => {
        this.bust(msg.channel);
      }, this.config.bustTimeout+bust.params.ms);
    }

    bust.busters.push({
      userID: msg.author.id,
      amount: amount,
      amountWon: 0
    });
  }

  bust(channel) {
    var bust = channel.guild.bust;
    bust.status = 0;
    var text = `💸 🛑 **Busted @${bust.params.bust}×** 🛑\n`;
    bust.busters.sort((a, b) => a.bust - b.bust);
    bust.busters.forEach((buster) => {
      text += `\n<@${buster.userID}> - ${buster.cashedOut ? `@**${buster.bust}**× (💵 ${this.largeNumber(buster.amountWon)})` : `💵 **-${this.largeNumber(buster.amount)}** - *LOST*`}`;
    })
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
        balance: this.config.baseBalance
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

  formatChance(amount, total) {
    return `${Math.round((amount/total)*10000)/100}%`;
  }

  async handleCredits(msg) {
    var user = await this.getUser(msg.author);
    var credits = user.balance;
    var text = `💸 <@${msg.author.id}> Current balance 💵 **${this.largeNumber(credits)}**`;
    this.client.createMessage(msg.channel.id, text);
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
    var ms = ((Math.round(Math.pow(Math.random(), 3.3)*40*1000))+100);
    return { ms: ms, bust: this.getBustFromMS(ms) };
  }

  getBustFromMS(ms) {
    //if(ms < 1000) ms = 1000;
    return (Math.floor(Math.pow(ms/1000, 1.06)*100)+100)/100;
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
}

var rl = new Roll();
rl.start();
