/**
 * One offline picture. The remote URL is fetched with the pairing token and
 * then shown from a local blob, so the <img> tag never talks to the brain.
 */
import { useEffect, useState } from "react";
import { Image, Pressable, type ImageStyle, type StyleProp } from "react-native";
import { loadAuthedMediaUrl } from "./offlineMedia.ts";

type Props = {
  remoteUrl: string;
  style: StyleProp<ImageStyle>;
  label: string;
  onOpen: (uri: string) => void;
};

export function OfflinePicture({ remoteUrl, style, label, onOpen }: Props) {
  const [uri, setUri] = useState("");

  useEffect(() => {
    let alive = true;
    let revoke = () => {};
    setUri("");
    if (!remoteUrl) return;
    void loadAuthedMediaUrl(remoteUrl).then((loaded) => {
      if (!alive || !loaded) return;
      revoke = loaded.revoke;
      setUri(loaded.url);
    });
    return () => {
      alive = false;
      revoke();
    };
  }, [remoteUrl]);

  if (!uri) return null;
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={label} onPress={() => onOpen(uri)}>
      <Image source={{ uri }} style={style} resizeMode="cover" />
    </Pressable>
  );
}
