import { MongoClient } from "https://deno.land/x/mongo@v0.31.2/mod.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";
const { DATABASE_URI } = config();

const client = new MongoClient();

export const connectToDB = async () => {
  if (!DATABASE_URI) {
    throw new Error("Missing env variable: DATABASE_UTI");
  }
  await client.connect(DATABASE_URI);
  return client.database("lingpal");
};

export const disconnectDB = async () => {
  client.close();
};
