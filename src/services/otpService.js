import crypto from "crypto";
import {saveOTP,getOTP} from "../model/userModel.js";

// generate secure OTP
export function generateOTP() {

    let length = 6;
    const digits = "123456789";
    let otp = "";

    for (let i = 0; i < length; i++) {
        otp += digits[crypto.randomInt(0, digits.length)];
    }

    return otp;
}

// hash OTP
export function hashOTP(otp) {
    return crypto.createHash("sha256").update(otp).digest("hex");
}

// save OTP to DB with expiry
export async function saveUserOTP(userId, otp) {

    const hashed = hashOTP(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // +5 mins
    await saveOTP(userId, hashed, expiresAt); 
}

// verify OTP
export async function verifyUserOTP(userId, inputOTP) {
    const [recordedOTP] = await getOTP(userId);
    if (!recordedOTP) return false;

    const inputHash = hashOTP(inputOTP);
    let dateNow=new Date();

    if (inputHash === recordedOTP.verification_code) {
        if (dateNow < recordedOTP.code_expires_at){
            return true;
        } 
    }
  

  return false;
}
