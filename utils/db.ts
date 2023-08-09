import { MongoClient } from "https://deno.land/x/mongo@v0.31.2/mod.ts";
import { config } from "https://deno.land/x/dotenv/mod.ts";
const { DATABASE_URI, ENVIRONMENT } = config();

const client = new MongoClient();

export const connectToDB = async () => {
  const databaseUri =
    ENVIRONMENT === "development" ? DATABASE_URI : Deno.env.get("DATABASE_URI");
  if (!databaseUri) {
    throw new Error("Missing env variable: DATABASE_UTI");
  }
  await client.connect(databaseUri);
  return client.database("lingpal");
};

export const disconnectDB = async () => {
  client.close();
};
