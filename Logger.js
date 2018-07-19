module.exports = class Logger {
  constructor(config) {
    this.config = config;
  }

  info(msg) {
    if(this.config.log.info) console.log(`${this.config.log.prefix}> ${msg}`);
  }

  warning(msg) {
    if(this.config.log.warning) console.log(`${this.config.log.prefix}> [WARN] ${msg}`);
  }

  verbose(msg) {
    if(this.config.log.verbose) console.log(`${this.config.log.prefix}> [VRBS] ${msg}`);
  }
}
