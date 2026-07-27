import mongoose from "mongoose";
import "dotenv/config";
import Role from "../models/Role";
import { UserRole } from "../type";

const DEFAULT_ROLES: { name: UserRole; description: string }[] = [
  { name: "admin", description: "Full system access across all branches" },
  { name: "manager", description: "Branch-level management and reporting" },
  { name: "cashier", description: "Handles payments and tab checkout" },
  { name: "bartender", description: "Opens and manages sale tabs" },
  { name: "store_keeper", description: "Manages inventory and stock movements" },
  { name: "accountant", description: "Read-only access to financial reports" },
];

const seedRoles = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log("DB connected");

    for (const roleData of DEFAULT_ROLES) {
      await Role.updateOne(
        { name: roleData.name },
        { $setOnInsert: roleData },
        { upsert: true }
      );
      console.log(`Role "${roleData.name}" — seeded`);
    }

    console.log("Role seeding complete");
  } catch (error: any) {
    console.error("Seed failed:", error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("DB disconnected");
  }
};

seedRoles();
