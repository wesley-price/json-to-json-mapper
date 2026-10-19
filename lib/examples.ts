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

export const EXAMPLES: Record<"source" | "target", Record<Format, ExampleFile>> = {
  source: {
    json: { text: JSON.stringify(SOURCE_JSON, null, 2), layout: defaultFlatLayout(), headers: SOURCE_HEADERS },
    xml: { text: SOURCE_XML, layout: defaultFlatLayout(), headers: SOURCE_HEADERS },
    csv: { text: SOURCE_CSV, layout: defaultFlatLayout() },
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
