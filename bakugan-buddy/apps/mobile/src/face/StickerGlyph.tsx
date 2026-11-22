/**
 * One Noto sticker on iOS and Android. The web build uses StickerGlyph.web.tsx
 * (lottie-web) because the DotLottie canvas was staying on the first frame.
 */
import { Text, View } from "react-native";
import LottieView from "lottie-react-native";
import { STICKER_LOTTIE } from "./stickerSources.ts";

export function StickerGlyph({ code, emoji, size }: { code: string; emoji: string; size: number }) {
  const source = STICKER_LOTTIE[code];
  if (!source) return <Text>{emoji}</Text>;
  return (
    <View style={{ width: size, height: size }} accessibilityLabel={emoji}>
      <LottieView source={source} autoPlay loop resizeMode="contain" style={{ width: size, height: size }} />
    </View>
  );
}
