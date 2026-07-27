import mongoose from "mongoose";
import "dotenv/config";
import Branch from "../models/Branch";

const seedBranch = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log("DB connected");

    await Branch.updateOne(
      { name: "Main Branch" },
      {
        $setOnInsert: {
          name: "Main Branch",
          isMain: true,
          isActive: true,
        },
      },
      { upsert: true }
    );
    console.log('Branch "Main Branch" — seeded');

    console.log("Branch seeding complete");
  } catch (error: any) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("DB disconnected");
  }
};

seedBranch();
