const MongoBucket = require('mongodb').GridFSBucket;
const MongoClient = require('mongodb').MongoClient;
//const MongoServer = require('mongodb').Server;

module.exports = class DBManager {
  constructor(n) {
    this.log = n.log;
    this.config = n.config;

    this.retriesCount = 0;
  }

  async connect() {
    return await this.dbConnect();
  }

  async dbConnect() {
    const url = `mongodb://${this.config.db.host || "localhost"}:${this.config.db.port || 27017}/`;

    const dbName = this.config.db.name || 'ncdn';
    let client;

    try {
      this.log.info("connecting to database..");
      client = await MongoClient.connect(url, { useNewUrlParser: true });

      this.log.info("connected to database");
      this.db = client.db(dbName);

      this.buckets = {};
      await this.checkCollections();

      //await this.initRenderer();
      return this.db;
    } catch (err) {
      return await this.retry(err);
    }
  }

  async retry(err) {
    this.log.info("an error occured while connecting to the database");
    console.log(err);
    this.retriesCount++;
    this.log.info(`retrying in 5 seconds (${this.retriesCount} retr${this.retriesCount > 1 ? "ies" : "y"})`);

    await this.sleep(5000);
    return await this.dbConnect();
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  createBucket(name) { // unused for now
    var bucket = new MongoBucket(this.db, {
      bucketName: name
    });

    this.buckets[name] = bucket;

    return bucket;
  }

  async checkCollections() { // unused for now
    var col = this.db.collection("stats.events");
    //console.log(col);
    //.createIndex( { "creationDate": 1 }, { expireAfterSeconds: 86400 } )
    return;
  }
}
