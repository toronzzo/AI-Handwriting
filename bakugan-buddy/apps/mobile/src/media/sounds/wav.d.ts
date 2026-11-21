/**
 * Metro asset imports: a bundled "*.wav" is a numeric asset id, which is
 * exactly the shape expo-audio's AudioSource expects.
 */
declare module "*.wav" {
  const asset: number;
  export default asset;
}
