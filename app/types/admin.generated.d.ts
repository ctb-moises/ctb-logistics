/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */
import type * as AdminTypes from './admin.types.js';

export type SettingsLocationsQueryVariables = AdminTypes.Exact<{ [key: string]: never; }>;


export type SettingsLocationsQuery = { locations: { nodes: Array<Pick<AdminTypes.Location, 'id' | 'name' | 'fulfillsOnlineOrders'>> } };

export type SettingsLocationQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type SettingsLocationQuery = { location?: AdminTypes.Maybe<Pick<AdminTypes.Location, 'id' | 'name' | 'isActive'>> };

export type InventorySyncRunMutationVariables = AdminTypes.Exact<{
  query: AdminTypes.Scalars['String']['input'];
}>;


export type InventorySyncRunMutation = { bulkOperationRunQuery?: AdminTypes.Maybe<{ bulkOperation?: AdminTypes.Maybe<Pick<AdminTypes.BulkOperation, 'id'>>, userErrors: Array<Pick<AdminTypes.BulkOperationUserError, 'message'>> }> };

export type InventorySyncStatusQueryVariables = AdminTypes.Exact<{
  id: AdminTypes.Scalars['ID']['input'];
}>;


export type InventorySyncStatusQuery = { node?: AdminTypes.Maybe<Pick<AdminTypes.BulkOperation, 'status' | 'errorCode' | 'url'>> };

export type InventorySyncItemQueryVariables = AdminTypes.Exact<{
  itemId: AdminTypes.Scalars['ID']['input'];
  locationId: AdminTypes.Scalars['ID']['input'];
}>;


export type InventorySyncItemQuery = { inventoryItem?: AdminTypes.Maybe<(
    Pick<AdminTypes.InventoryItem, 'id' | 'sku' | 'tracked'>
    & { variant: (
      Pick<AdminTypes.ProductVariant, 'id' | 'title' | 'barcode'>
      & { product: (
        Pick<AdminTypes.Product, 'id' | 'title'>
        & { featuredMedia?: AdminTypes.Maybe<{ preview?: AdminTypes.Maybe<{ image?: AdminTypes.Maybe<Pick<AdminTypes.Image, 'url'>> }> }> }
      ) }
    ), inventoryLevel?: AdminTypes.Maybe<{ quantities: Array<Pick<AdminTypes.InventoryQuantity, 'quantity'>> }> }
  )> };

export type ReceiveStockMutationVariables = AdminTypes.Exact<{
  input: AdminTypes.InventoryAdjustQuantitiesInput;
  idempotencyKey: AdminTypes.Scalars['String']['input'];
}>;


export type ReceiveStockMutation = { inventoryAdjustQuantities?: AdminTypes.Maybe<{ inventoryAdjustmentGroup?: AdminTypes.Maybe<{ changes: Array<Pick<AdminTypes.InventoryChange, 'name' | 'quantityAfterChange'>> }>, userErrors: Array<Pick<AdminTypes.InventoryAdjustQuantitiesUserError, 'code' | 'message'>> }> };

export type ReceiveStockOnHandQueryVariables = AdminTypes.Exact<{
  itemId: AdminTypes.Scalars['ID']['input'];
  locationId: AdminTypes.Scalars['ID']['input'];
}>;


export type ReceiveStockOnHandQuery = { inventoryItem?: AdminTypes.Maybe<{ inventoryLevel?: AdminTypes.Maybe<{ quantities: Array<Pick<AdminTypes.InventoryQuantity, 'quantity'>> }> }> };

export type PickingCandidateOrdersQueryVariables = AdminTypes.Exact<{
  query: AdminTypes.Scalars['String']['input'];
  after?: AdminTypes.InputMaybe<AdminTypes.Scalars['String']['input']>;
}>;


export type PickingCandidateOrdersQuery = { orders: { nodes: Array<(
      Pick<AdminTypes.Order, 'id' | 'name' | 'createdAt' | 'currentSubtotalLineItemsQuantity'>
      & { fulfillmentOrders: { nodes: Array<{ assignedLocation: { location?: AdminTypes.Maybe<Pick<AdminTypes.Location, 'id'>> } }> } }
    )>, pageInfo: Pick<AdminTypes.PageInfo, 'hasNextPage' | 'endCursor'> } };

export type PickingOrderLinesQueryVariables = AdminTypes.Exact<{
  ids: Array<AdminTypes.Scalars['ID']['input']> | AdminTypes.Scalars['ID']['input'];
}>;


export type PickingOrderLinesQuery = { nodes: Array<AdminTypes.Maybe<(
    Pick<AdminTypes.Order, 'id'>
    & { fulfillmentOrders: { nodes: Array<{ assignedLocation: { location?: AdminTypes.Maybe<Pick<AdminTypes.Location, 'id'>> }, lineItems: { nodes: Array<(
            Pick<AdminTypes.FulfillmentOrderLineItem, 'inventoryItemId' | 'remainingQuantity' | 'requiresShipping' | 'productTitle' | 'variantTitle' | 'sku'>
            & { image?: AdminTypes.Maybe<Pick<AdminTypes.Image, 'url'>>, variant?: AdminTypes.Maybe<Pick<AdminTypes.ProductVariant, 'id' | 'barcode'>> }
          )> } }> } }
  )>> };

interface GeneratedQueryTypes {
  "#graphql\n  query SettingsLocations {\n    locations(first: 250, includeInactive: false) {\n      nodes {\n        id\n        name\n        fulfillsOnlineOrders\n      }\n    }\n  }\n": {return: SettingsLocationsQuery, variables: SettingsLocationsQueryVariables},
  "#graphql\n  query SettingsLocation($id: ID!) {\n    location(id: $id) {\n      id\n      name\n      isActive\n    }\n  }\n": {return: SettingsLocationQuery, variables: SettingsLocationQueryVariables},
  "#graphql\n  query InventorySyncStatus($id: ID!) {\n    node(id: $id) {\n      ... on BulkOperation {\n        status\n        errorCode\n        url\n      }\n    }\n  }\n": {return: InventorySyncStatusQuery, variables: InventorySyncStatusQueryVariables},
  "#graphql\n  query InventorySyncItem($itemId: ID!, $locationId: ID!) {\n    inventoryItem(id: $itemId) {\n      id\n      sku\n      tracked\n      variant {\n        id\n        title\n        barcode\n        product {\n          id\n          title\n          featuredMedia {\n            preview {\n              image {\n                url\n              }\n            }\n          }\n        }\n      }\n      inventoryLevel(locationId: $locationId) {\n        quantities(names: [\"on_hand\"]) {\n          quantity\n        }\n      }\n    }\n  }\n": {return: InventorySyncItemQuery, variables: InventorySyncItemQueryVariables},
  "#graphql\n  query ReceiveStockOnHand($itemId: ID!, $locationId: ID!) {\n    inventoryItem(id: $itemId) {\n      inventoryLevel(locationId: $locationId) {\n        quantities(names: [\"on_hand\"]) {\n          quantity\n        }\n      }\n    }\n  }\n": {return: ReceiveStockOnHandQuery, variables: ReceiveStockOnHandQueryVariables},
  "#graphql\n  query PickingCandidateOrders($query: String!, $after: String) {\n    orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT) {\n      nodes {\n        id\n        name\n        createdAt\n        currentSubtotalLineItemsQuantity\n        fulfillmentOrders(first: 10, query: \"status:open\") {\n          nodes {\n            assignedLocation {\n              location {\n                id\n              }\n            }\n          }\n        }\n      }\n      pageInfo {\n        hasNextPage\n        endCursor\n      }\n    }\n  }\n": {return: PickingCandidateOrdersQuery, variables: PickingCandidateOrdersQueryVariables},
  "#graphql\n  query PickingOrderLines($ids: [ID!]!) {\n    nodes(ids: $ids) {\n      ... on Order {\n        id\n        fulfillmentOrders(first: 5, query: \"status:open\") {\n          nodes {\n            assignedLocation {\n              location {\n                id\n              }\n            }\n            lineItems(first: 50) {\n              nodes {\n                inventoryItemId\n                remainingQuantity\n                requiresShipping\n                productTitle\n                variantTitle\n                sku\n                image {\n                  url\n                }\n                variant {\n                  id\n                  barcode\n                }\n              }\n            }\n          }\n        }\n      }\n    }\n  }\n": {return: PickingOrderLinesQuery, variables: PickingOrderLinesQueryVariables},
}

interface GeneratedMutationTypes {
  "#graphql\n  mutation InventorySyncRun($query: String!) {\n    bulkOperationRunQuery(query: $query) {\n      bulkOperation {\n        id\n      }\n      userErrors {\n        message\n      }\n    }\n  }\n": {return: InventorySyncRunMutation, variables: InventorySyncRunMutationVariables},
  "#graphql\n  mutation ReceiveStock(\n    $input: InventoryAdjustQuantitiesInput!\n    $idempotencyKey: String!\n  ) {\n    inventoryAdjustQuantities(input: $input)\n      @idempotent(key: $idempotencyKey) {\n      inventoryAdjustmentGroup {\n        # Only the adjusted quantity (\"available\") is returned unless asked.\n        changes(quantityNames: [\"on_hand\"]) {\n          name\n          quantityAfterChange\n        }\n      }\n      userErrors {\n        code\n        message\n      }\n    }\n  }\n": {return: ReceiveStockMutation, variables: ReceiveStockMutationVariables},
}
declare module '@shopify/admin-api-client' {
  type InputMaybe<T> = AdminTypes.InputMaybe<T>;
  interface AdminQueries extends GeneratedQueryTypes {}
  interface AdminMutations extends GeneratedMutationTypes {}
}
