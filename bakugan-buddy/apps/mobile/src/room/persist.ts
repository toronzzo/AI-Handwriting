import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "bakugan-buddy.alive.v1";

export async function readAliveMemory(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function writeAliveMemory(json: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, json);
  } catch {
    /* the sim keeps the log either way */
  }
}
