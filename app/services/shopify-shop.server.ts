import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const SHOP_TIMEZONE_QUERY = `#graphql
  query ShopTimezone {
    shop {
      ianaTimezone
    }
  }
`;

export async function fetchShopTimezone(admin: AdminApiContext) {
  const response = await admin.graphql(SHOP_TIMEZONE_QUERY);
  const { data } = await response.json();
  return data?.shop.ianaTimezone ?? "UTC";
}
