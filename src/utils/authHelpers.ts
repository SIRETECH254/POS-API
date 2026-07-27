import jwt from "jsonwebtoken";
import { IUser } from "../type";

export const generateTokens = (user: IUser): { accessToken: string; refreshToken: string } => {
  const payload = {
    userId: user._id,
    branchId: user.branch,
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN || "15m") as any,
  });

  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.REFRESH_TOKEN_SECRET as string,
    { expiresIn: "7d" }
  );

  return { accessToken, refreshToken };
};
