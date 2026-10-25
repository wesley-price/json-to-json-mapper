// Example files for "Load example". Every source describes the same customer
// order and every target is the same empty invoice, so any source format can
// be mapped onto any target format.

import { type FlatLayout, type Format, defaultFlatLayout } from "./formats";
import type { Headers } from "./headers";
import type { Translation } from "./transforms";

const PAYMENT_CODES: Translation = {
  pairs: [
    ["INSUFFICIENT_FUNDS", "PAY-001"],
    ["CARD_EXPIRED", "PAY-002"],
    ["CARD_DECLINED", "PAY-003"],
  ],
  otherwise: "default",
  defaultValue: "GEN-500",
};

export interface ExampleFile {
  text: string;
  /** Layout for flat files (record codes and field names). */
  layout: FlatLayout;
  /** Headers that travel with the document (JSON and XML only). */
  headers?: Headers;
}

// Message headers on the order documents, e.g. which store sent it.
const SOURCE_HEADERS: Headers = { "store-loc": "STORE-042", "message-id": "MSG-7781" };

function flatLayout(fields: { header: string[]; body: string[]; footer: string[] }, codes: [string, string, string]) {
  const layout = defaultFlatLayout();
  layout.delimiter = "|";
  layout.identifyBy = "code";
  layout.header = { ...layout.header, code: codes[0], fields: fields.header };
  layout.body = { ...layout.body, code: codes[1], fields: fields.body };
  layout.footer = { ...layout.footer, code: codes[2], fields: fields.footer };
  return layout;
}

const SOURCE_JSON = {
  orderId: "A-1001",
  orderDate: "2026-10-18",
  customer: {
    id: 1042,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    address: { street: "12 Analytical Way", city: "London", zip: "N1 9GU" },
  },
  lines: [
    { sku: "X1", description: "Widget", qty: 2, price: 9.99 },
    { sku: "Y2", description: "Gadget", qty: 1, price: 5.5 },
  ],
  total: 25.48,
};

const SOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<order id="A-1001" date="2026-10-18">
  <customer id="1042">
    <firstName>Ada</firstName>
    <lastName>Lovelace</lastName>
    <email>ada@example.com</email>
    <address>
      <street>12 Analytical Way</street>
      <city>London</city>
      <zip>N1 9GU</zip>
    </address>
  </customer>
  <line sku="X1" qty="2" price="9.99">Widget</line>
  <line sku="Y2" qty="1" price="5.50">Gadget</line>
  <total>25.48</total>
</order>
`;

const SOURCE_FLAT = `H|A-1001|20261018|1042|Ada Lovelace|ada@example.com
D|X1|Widget|2|9.99
D|Y2|Gadget|1|5.50
T|2|25.48
`;

// One row per order line, with the order details repeated on each row.
const SOURCE_CSV = `orderId,orderDate,customerName,email,sku,description,qty,price
A-1001,2026-10-18,Ada Lovelace,ada@example.com,X1,Widget,2,9.99
A-1001,2026-10-18,Ada Lovelace,ada@example.com,Y2,"Gadget, large",1,5.50
`;

const TARGET_JSON = {
  reference: "",
  placedOn: "",
  buyer: { name: "", email: "", postcode: "" },
  items: [{ code: "", name: "", quantity: 0, unitPrice: 0 }],
  grandTotal: 0,
};

// Two <item> elements so the template reads as a list of items.
const TARGET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<invoice number="" date="">
  <buyer>
    <name/>
    <email/>
    <postcode/>
  </buyer>
  <item code="" quantity="0" unitPrice="0">
    <name/>
  </item>
  <item code="" quantity="0" unitPrice="0">
    <name/>
  </item>
  <grandTotal>0</grandTotal>
</invoice>
`;

const TARGET_CSV = `reference,code,name,quantity,unitPrice
,,,0,0
`;

const TARGET_FLAT = `HDR||
DTL|||0|0
TRL|0|0
`;

// The same order as database tables: definitions plus a sample row each.
const SOURCE_TABLE = `CREATE TABLE orders (
  order_id      VARCHAR(20) PRIMARY KEY,
  order_date    DATE NOT NULL,
  customer_id   INTEGER REFERENCES customers(id),
  total         NUMERIC(10,2)
);
CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  first_name  VARCHAR(50),
  last_name   VARCHAR(50),
  email       VARCHAR(255)
);
INSERT INTO orders VALUES ('A-1001', '2026-10-18', 1042, 25.48);
INSERT INTO customers VALUES (1042, 'Ada', 'Lovelace', 'ada@example.com');
`;

const TARGET_TABLE = `CREATE TABLE invoices (
  reference    VARCHAR(20) PRIMARY KEY,
  placed_on    DATE,
  buyer_name   VARCHAR(120),
  buyer_email  VARCHAR(255),
  grand_total  NUMERIC(10,2)
);
`;

// The order as a Kafka event, and as an Avro schema; the invoice likewise.
const SOURCE_KAFKA = JSON.stringify(
  {
    topic: "shop.orders",
    key: "A-1001",
    headers: { "event-type": "OrderPlaced", traceparent: "00-4bf92f3577b34da6-01" },
    timestamp: "2026-10-18T09:30:00Z",
    value: {
      orderId: "A-1001",
      customer: { id: 1042, firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      lines: [
        { sku: "X1", qty: 2, price: 9.99 },
        { sku: "Y2", qty: 1, price: 5.5 },
      ],
      total: 25.48,
    },
  },
  null,
  2,
);

const SOURCE_AVRO = JSON.stringify(
  {
    type: "record",
    name: "OrderPlaced",
    namespace: "com.shop.orders",
    fields: [
      { name: "orderId", type: "string" },
      { name: "placedAt", type: { type: "long", logicalType: "timestamp-millis" } },
      {
        name: "customer",
        type: {
          type: "record",
          name: "Customer",
          fields: [
            { name: "id", type: "long" },
            { name: "email", type: ["null", "string"], default: null },
          ],
        },
      },
      { name: "status", type: { type: "enum", name: "OrderStatus", symbols: ["PLACED", "PAID", "SHIPPED"] } },
      { name: "total", type: { type: "bytes", logicalType: "decimal", precision: 10, scale: 2 } },
    ],
  },
  null,
  2,
);

const TARGET_AVRO = JSON.stringify(
  {
    type: "record",
    name: "InvoiceIssued",
    namespace: "com.shop.billing",
    fields: [
      { name: "reference", type: "string", doc: "The order number" },
      { name: "buyerEmail", type: ["null", "string"], default: null },
      { name: "grandTotal", type: "double" },
      { name: "currency", type: "string", default: "GBP" },
    ],
  },
  null,
  2,
);

const TARGET_KAFKA = JSON.stringify(
  {
    topic: "shop.invoices",
    key: "",
    headers: { "event-type": "InvoiceIssued" },
    timestamp: "",
    value: { reference: "", buyer: { name: "", email: "" }, grandTotal: 0 },
  },
  null,
  2,
);

// The order and the invoice as JSON Schemas (as found in an OpenAPI spec).
const SOURCE_JSONSCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["orderId", "orderDate"],
    properties: {
      orderId: { type: "string", example: "A-1001" },
      orderDate: { type: "string", format: "date", example: "2026-10-18" },
      customer: {
        type: "object",
        properties: {
          firstName: { type: "string", example: "Ada" },
          lastName: { type: "string", example: "Lovelace" },
          email: { type: "string", format: "email", example: "ada@example.com" },
        },
      },
      total: { type: "number", example: 25.48 },
    },
  },
  null,
  2,
);

const TARGET_JSONSCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["reference", "status", "grandTotal"],
    additionalProperties: false,
    properties: {
      reference: { type: "string", pattern: "^[A-Z]-\\d+$", description: "The order number" },
      issuedOn: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["DRAFT", "ISSUED", "PAID"] },
      buyer: {
        type: "object",
        properties: { name: { type: "string", maxLength: 80 }, email: { type: "string", format: "email" } },
      },
      grandTotal: { type: "number", minimum: 0 },
    },
  },
  null,
  2,
);

export const EXAMPLES: Record<"source" | "target", Record<Format, ExampleFile>> = {
  source: {
    json: { text: JSON.stringify(SOURCE_JSON, null, 2), layout: defaultFlatLayout(), headers: SOURCE_HEADERS },
    xml: { text: SOURCE_XML, layout: defaultFlatLayout(), headers: SOURCE_HEADERS },
    csv: { text: SOURCE_CSV, layout: defaultFlatLayout() },
    table: { text: SOURCE_TABLE, layout: defaultFlatLayout() },
    avro: { text: SOURCE_AVRO, layout: defaultFlatLayout() },
    kafka: { text: SOURCE_KAFKA, layout: defaultFlatLayout() },
    jsonschema: { text: SOURCE_JSONSCHEMA, layout: defaultFlatLayout() },
    flat: {
      text: SOURCE_FLAT,
      layout: flatLayout(
        {
          header: ["recordType", "orderId", "orderDate", "customerId", "customerName", "email"],
          body: ["recordType", "sku", "description", "qty", "price"],
          footer: ["recordType", "lineCount", "total"],
        },
        ["H", "D", "T"],
      ),
    },
  },
  target: {
    json: { text: JSON.stringify(TARGET_JSON, null, 2), layout: defaultFlatLayout() },
    xml: { text: TARGET_XML, layout: defaultFlatLayout() },
    csv: { text: TARGET_CSV, layout: defaultFlatLayout() },
    table: { text: TARGET_TABLE, layout: defaultFlatLayout() },
    avro: { text: TARGET_AVRO, layout: defaultFlatLayout() },
    kafka: { text: TARGET_KAFKA, layout: defaultFlatLayout() },
    jsonschema: { text: TARGET_JSONSCHEMA, layout: defaultFlatLayout() },
    flat: {
      text: TARGET_FLAT,
      layout: flatLayout(
        {
          header: ["recordType", "reference", "date"],
          body: ["recordType", "code", "name", "quantity", "unitPrice"],
          footer: ["recordType", "lineCount", "total"],
        },
        ["HDR", "DTL", "TRL"],
      ),
    },
  },
};

// ---------- Multi-source example: normalising downstream errors ----------

export interface MultiExampleSource {
  name: string;
  format: Format;
  text: string;
  headers?: Headers;
  cases: {
    name: string;
    when: { path: string[]; op: "gte" | "lt" | "equals"; value: string }[];
    /** [source path, standard path] */
    maps: [string[], string[]][];
    /** [fixed value, standard path] */
    constants?: [string, string[]][];
    /** Translation tables, by the standard path they write (joined with "."). */
    translate?: Record<string, Translation>;
  }[];
}

/** The standard error response every downstream error is normalised into. */
export const STANDARD_ERROR = {
  error: { code: "", message: "", httpStatus: 0, retryable: false, correlationId: "", sourceSystem: "" },
};

export const MULTI_EXAMPLE: MultiExampleSource[] = [
  {
    name: "Payments API",
    format: "json",
    headers: { "x-request-id": "req-889" },
    text: JSON.stringify(
      { status: 402, errorCode: "INSUFFICIENT_FUNDS", errorMessage: "Card declined: insufficient funds", retry: false },
      null,
      2,
    ),
    cases: [
      {
        name: "Client errors (4xx)",
        when: [
          { path: ["status"], op: "gte", value: "400" },
          { path: ["status"], op: "lt", value: "500" },
        ],
        maps: [
          [["errorCode"], ["error", "code"]],
          [["errorMessage"], ["error", "message"]],
          [["status"], ["error", "httpStatus"]],
          [["retry"], ["error", "retryable"]],
          [["$headers", "x-request-id"], ["error", "correlationId"]],
        ],
        constants: [["payments", ["error", "sourceSystem"]]],
        translate: { "error.code": PAYMENT_CODES },
      },
      {
        name: "Otherwise",
        when: [],
        maps: [
          [["errorCode"], ["error", "code"]],
          [["errorMessage"], ["error", "message"]],
          [["status"], ["error", "httpStatus"]],
          [["$headers", "x-request-id"], ["error", "correlationId"]],
        ],
        constants: [["payments", ["error", "sourceSystem"]]],
        translate: { "error.code": PAYMENT_CODES },
      },
    ],
  },
  {
    name: "Inventory SOAP",
    format: "xml",
    text: `<?xml version="1.0" encoding="UTF-8"?>
<Fault>
  <faultcode>soap:Server</faultcode>
  <faultstring>Stock service unavailable</faultstring>
  <detail>
    <errorId>INV-503</errorId>
    <httpStatus>503</httpStatus>
    <requestRef>r-77</requestRef>
  </detail>
</Fault>
`,
    cases: [
      {
        name: "All faults",
        when: [],
        maps: [
          [["Fault", "detail", "errorId"], ["error", "code"]],
          [["Fault", "faultstring"], ["error", "message"]],
          [["Fault", "detail", "httpStatus"], ["error", "httpStatus"]],
          [["Fault", "detail", "requestRef"], ["error", "correlationId"]],
        ],
        constants: [["inventory", ["error", "sourceSystem"]]],
      },
    ],
  },
  {
    name: "Legacy batch",
    format: "csv",
    text: "code,text,ref\nE42,Account locked,LEG-9\n",
    cases: [
      {
        name: "All rows",
        when: [],
        maps: [
          [["[]", "code"], ["error", "code"]],
          [["[]", "text"], ["error", "message"]],
          [["[]", "ref"], ["error", "correlationId"]],
        ],
        constants: [["legacy", ["error", "sourceSystem"]]],
        translate: { "error.code": { pairs: [["E42", "ACC-423"]], otherwise: "keep", defaultValue: "" } },
      },
    ],
  },
];

// ---------- merged multi-source example: three systems fill one order summary ----------

export const MERGE_STANDARD = {
  orderId: "",
  placedAt: "",
  customer: { id: 0, name: "", email: "", tier: "" },
  payment: { method: "", status: "", amount: 0 },
  shipping: { carrier: "", trackingNumber: "" },
  channel: "",
};

export const MERGE_EXAMPLE: MultiExampleSource[] = [
  {
    name: "CRM (customers table)",
    format: "table",
    text: `CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  full_name     VARCHAR(120),
  email         VARCHAR(255),
  loyalty_tier  VARCHAR(20)
);
INSERT INTO customers VALUES (1042, 'Ada Lovelace', 'ada@example.com', 'gold');
`,
    cases: [
      {
        name: "All",
        when: [],
        maps: [
          [["customers", "id"], ["customer", "id"]],
          [["customers", "full_name"], ["customer", "name"]],
          [["customers", "email"], ["customer", "email"]],
          [["customers", "loyalty_tier"], ["customer", "tier"]],
        ],
      },
    ],
  },
  {
    name: "Order service",
    format: "json",
    text: JSON.stringify(
      { id: "A-1001", createdAt: "2026-10-18T09:30:00Z", customerId: 1042, shipping: { carrier: "UPS", tracking: "1Z999AA10123456784" } },
      null,
      2,
    ),
    cases: [
      {
        name: "All",
        when: [],
        maps: [
          [["id"], ["orderId"]],
          [["createdAt"], ["placedAt"]],
          [["customerId"], ["customer", "id"]],
          [["shipping", "carrier"], ["shipping", "carrier"]],
          [["shipping", "tracking"], ["shipping", "trackingNumber"]],
        ],
        constants: [["web", ["channel"]]],
      },
    ],
  },
  {
    name: "Payments",
    format: "xml",
    text: `<payment order="A-1001">
  <method>card</method>
  <status>captured</status>
  <amount currency="GBP">25.48</amount>
</payment>
`,
    cases: [
      {
        name: "All",
        when: [],
        maps: [
          [["payment", "method"], ["payment", "method"]],
          [["payment", "status"], ["payment", "status"]],
          [["payment", "amount", "#text"], ["payment", "amount"]],
        ],
      },
    ],
  },
];
