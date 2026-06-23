sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/IconTabFilter",
    "sap/m/Input",
    "sap/m/ComboBox",
    "sap/m/CheckBox",
    "sap/m/DatePicker",
    "sap/m/Label",
    "sap/m/Panel",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Button",
    "sap/m/SegmentedButton",
    "sap/m/SegmentedButtonItem",
    "sap/ui/unified/FileUploader",
    "sap/ui/core/Item",
    "sap/ui/core/Icon",
    "sap/ui/layout/form/SimpleForm",
    "sap/ui/core/Fragment"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, IconTabFilter, Input, ComboBox, CheckBox, DatePicker,
    Label, Panel, VBox, HBox, Text, Table, Column, ColumnListItem, Button, SegmentedButton, SegmentedButtonItem,
    FileUploader, Item, CoreIcon, SimpleForm, Fragment
) {
    "use strict";

    // Strongest field status wins when the same field comes from several roles.
    var STATUS_RANK = { REQUIRED: 3, OPTIONAL: 2, SUPPRESS: 1 };

    // Maps a field's SAP source table to the replicated reference-list service
    // entity that supplies its dropdown values. Extend as more lists are wired.
    var SOURCE_TO_LOOKUP = {
        T001  : "CompanyCodes",
        T001W : "Plants",
        TVKO  : "SalesOrgs",
        TVTW  : "DistChannels",
        TSPA  : "Divisions",
        T005  : "Countries",
        TCURC : "Currencies",
        T052  : "PaymentTerms",
        T016  : "Industries"
    };

    return Controller.extend("mdm.portal.controller.CreateBP", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oRt = new JSONModel(this._freshState());
            this.getView().setModel(this._oRt, "rt");

            this.getView().setModel(new JSONModel({ items: [] }), "cat");
            this.getView().setModel(new JSONModel({ items: [] }), "roles");
            this.getView().setModel(new JSONModel({ items: [] }), "ag");
            // Captures the dynamically generated field values, keyed by field_id.
            this.getView().setModel(new JSONModel({ values: {} }), "form");

            // group_id -> { description, icon, sequence } for tab labels/icons
            this._mGroups = {};
            // account_group_id -> { number_range_id, assignment_mode, type }
            this._mAccountGroups = {};
            // role_id -> { description, account_scope } for the Active Role bar
            this._mRoleMeta = {};
            // picked role_id -> [its own resolved prerequisite role_ids]
            this._mRolePrereqs = {};
            // role_id -> [{ field_id, description, display, data_type, ... }]
            // prerequisite fields that must be filled before main tabs unlock
            this._mRolePrereqFields = {};
            // IconTabFilter items for the regular (non-prereq) tabs — tracked so
            // they can be enabled/disabled when prereq completion changes
            this._aMainTabItems = [];
            // Full set of field assignments across every effective (selected +
            // prereq) role, cached so switching the active role re-filters in
            // memory instead of re-querying the service.
            this._aAllAssignments = [];

            this._loadLookups();

            this.getOwnerComponent().getRouter()
                .getRoute("createBP").attachPatternMatched(this._onRouteMatched, this);
        },

        _freshState: function () {
            return {
                mode             : "CREATE",   // "CREATE" | "EXTEND"
                status           : "New",
                subtitle         : "Select a BP role to generate the input form",
                started          : false,
                hasRoles         : false,
                canSave          : false,
                categoryId       : "",
                extendBp         : "",
                // Extend-mode: the selected existing BP record
                extendBpData     : null,
                // role_id -> "new" | <instance_no> | undefined
                roleInstance     : {},
                // role_id -> "edit" | "copy"
                roleInstanceMode : {},
                roleKeys         : [],
                activeRole       : "",
                bpAgId           : "",
                bpNumber         : "",
                numberRange      : "\u2014",
                bpNumberEditable : false,
                bpNumberPlaceholder: "\u2014",
                bpNumberHelp     : "Will be set based on the selected role(s).",
                // header strip
                catDisp          : "\u2014",
                roleDisp         : "\u2014",
                bpAgDisp         : "",
                nrDisp           : "\u2014",
                preqDisp         : "\u2014"
            };
        },

        _onRouteMatched: function () {
            this._oRt.setData(this._freshState());
            this._aAllAssignments = [];
            this._mRolePrereqFields = {};
            this._mRoleInstances = {};
            this._aMainTabItems = [];
            this.getView().getModel("form").setProperty("/values", {});
            var oTabs = this.byId("cbpTabs");
            if (oTabs) { oTabs.destroyItems(); }
            var oRoleBar = this.byId("cbpRoleBar");
            if (oRoleBar) { oRoleBar.destroyItems(); }
            if (this._oBpSearchDialog) { this._oBpSearchDialog.destroy(); this._oBpSearchDialog = null; }
            if (this._oRoleInstDialog)  { this._oRoleInstDialog.destroy();  this._oRoleInstDialog  = null; }
            if (this._oAgVHDialog)      { this._oAgVHDialog.destroy();      this._oAgVHDialog      = null; }
            if (this._oRoleVHDialog)    { this._oRoleVHDialog.destroy();    this._oRoleVHDialog    = null; }
        },

        // ── Load configuration lookups from the service ──────────────
        _loadLookups: function () {
            var oModel = this.getOwnerComponent().getModel();

            // BP Categories
            oModel.bindList("/BPCategories", null, [new Sorter("sequence")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 200).then(function (aCtx) {
                this.getView().getModel("cat").setProperty("/items", aCtx.map(function (c) {
                    return { key: c.getProperty("category_id"), text: c.getProperty("description") };
                }));
            }.bind(this)).catch(this._loadError("categories"));

            // BP Roles
            oModel.bindList("/BPRoles", null, [new Sorter("sequence")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 500).then(function (aCtx) {
                this._mRoleMeta = {};
                var aItems = aCtx.map(function (c) {
                    var sId    = c.getProperty("role_id");
                    var sDesc  = c.getProperty("description") || "";
                    var sScope = c.getProperty("account_scope") || "";
                    var bPrereq= false; // will be updated after dependency load if needed
                    this._mRoleMeta[sId] = { description: sDesc, account_scope: sScope };
                    var sScopeDisp = sScope === "CUSTOMER" ? "Customer"
                                   : sScope === "VENDOR"   ? "Vendor"
                                   : sScope === "Both"     ? "Both"
                                   : sScope || "\u2014";
                    return {
                        key        : sId,
                        text       : sId + " \u2014 " + sDesc,
                        description: sDesc,
                        scopeDisp  : sScopeDisp,
                        hasPrereq  : false,
                        selected   : false
                    };
                }.bind(this));
                this.getView().getModel("roles").setProperty("/items", aItems);

                // Mark roles that have prerequisites defined
                oModel.bindList("/BPRoleDependencies")
                    .requestContexts(0, 500).then(function (aDeps) {
                        var aRolesWithPrereq = new Set(
                            aDeps.map(function (d) { return d.getProperty("role_role_id"); })
                        );
                        var aUpdated = this.getView().getModel("roles").getProperty("/items");
                        aUpdated.forEach(function (item) {
                            item.hasPrereq = aRolesWithPrereq.has(item.key);
                        });
                        this.getView().getModel("roles").setProperty("/items", aUpdated);
                    }.bind(this)).catch(function () { /* non-fatal */ });

            }.bind(this)).catch(this._loadError("roles"));

            // Account Groups
            oModel.bindList("/AccountGroups", null, [new Sorter("account_group_id")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 500).then(function (aCtx) {
                var aItems = [];
                aCtx.forEach(function (c) {
                    var sId   = c.getProperty("account_group_id");
                    var sDesc = c.getProperty("description") || "";
                    var sNr   = c.getProperty("number_range_id") || "";
                    var sMode = c.getProperty("assignment_mode") || "";
                    var sType = c.getProperty("type") || "";
                    this._mAccountGroups[sId] = {
                        number_range_id: sNr,
                        assignment_mode: sMode,
                        type           : sType
                    };
                    aItems.push({
                        key        : sId,
                        text       : sId + " \u2014 " + sDesc,
                        description: sDesc,
                        type       : sType,
                        numberRange: sNr + (sMode ? " (" + sMode + ")" : "")
                    });
                }.bind(this));
                this.getView().getModel("ag").setProperty("/items", aItems);
            }.bind(this)).catch(this._loadError("account groups"));

            // Field Groups (for tab labels / icons)
            oModel.bindList("/FieldGroups", null, [new Sorter("sequence")])
                .requestContexts(0, 1000).then(function (aCtx) {
                    aCtx.forEach(function (c) {
                        this._mGroups[c.getProperty("group_id")] = {
                            description: c.getProperty("description") || c.getProperty("group_id"),
                            icon       : c.getProperty("icon") || "",
                            sequence   : c.getProperty("sequence") || 0
                        };
                    }.bind(this));
                }.bind(this)).catch(this._loadError("field groups"));

            // Field catalogue: field_id -> source_table. Loaded once and used to
            // resolve a field's value list, so dropdown population does not depend
            // on source_table surviving the per-role $expand (which can be dropped
            // by the OData entity cache if the field was loaded elsewhere first).
            this._mFieldSource = {};
            oModel.bindList("/FieldMasters", null, null, null, {
                $select: "field_id,source_table"
            }).requestContexts(0, 2000).then(function (aCtx) {
                aCtx.forEach(function (c) {
                    this._mFieldSource[c.getProperty("field_id")] = c.getProperty("source_table") || "";
                }.bind(this));
            }.bind(this)).catch(this._loadError("field catalogue"));
        },

        _loadError: function (sWhat) {
            return function (oErr) {
                MessageToast.show("Could not load " + sWhat + ": " + (oErr && oErr.message || "error"));
            };
        },

        // ── Step 0 handlers ──────────────────────────────────────────
        onCategoryChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sKey  = oItem ? oItem.getKey() : "";
            this._oRt.setProperty("/mode", "CREATE");
            this._oRt.setProperty("/categoryId", sKey);
            this._oRt.setProperty("/catDisp", oItem ? oItem.getText() : "\u2014");
            this._oRt.setProperty("/started", !!sKey);
            this._oRt.setProperty("/extendBp", "");
            if (sKey) {
                this._oRt.setProperty("/subtitle", "New BP \u00b7 select roles to generate the form");
            }
            this._recomputeCanSave();
        },

        onExtendSearch: function () {
            this._openBpSearchDialog();
        },

        // ── Existing-BP search dialog ────────────────────────────────
        _openBpSearchDialog: function () {
            var oView = this.getView();
            if (!this._oBpSearchDialog) {
                this._oBpSearchModel = new JSONModel({ items: [], busy: false, query: "", country: "", category: "" });
                this._oBpSearchDialog = new sap.m.Dialog({
                    title       : "Search — Existing Business Partner",
                    contentWidth: "50rem",
                    content     : [
                        new VBox({ items: [
                            new HBox({ alignItems: "End", items: [
                                new VBox({ width: "50%", class: "sapUiSmallMarginEnd", items: [
                                    new Label({ text: "Search (BP number / name)" }),
                                    new Input({ value: "{bpSearch>/query}", width: "100%",
                                        liveChange: this._refreshBpSearch.bind(this) })
                                ]}),
                                new VBox({ width: "25%", class: "sapUiSmallMarginEnd", items: [
                                    new Label({ text: "Country" }),
                                    new Input({ value: "{bpSearch>/country}", width: "100%",
                                        liveChange: this._refreshBpSearch.bind(this) })
                                ]}),
                                new Button({ text: "Search", type: "Emphasized",
                                    press: this._refreshBpSearch.bind(this) })
                            ]}),
                            new Table({
                                id         : "bpSearchTable",
                                noDataText : "No matching business partners found.",
                                busy       : "{bpSearch>/busy}",
                                columns    : [
                                    new Column({ header: new Label({ text: "BP Number" }) }),
                                    new Column({ header: new Label({ text: "Name" }) }),
                                    new Column({ header: new Label({ text: "Category" }) }),
                                    new Column({ header: new Label({ text: "Status" }) })
                                ],
                                items : {
                                    path    : "bpSearch>/items",
                                    template: new ColumnListItem({
                                        type : "Active",
                                        press: this._onBpSearchRowPress.bind(this),
                                        cells: [
                                            new Text({ text: "{bpSearch>bp_number}" }),
                                            new Text({ text: "{bpSearch>name}" }),
                                            new Text({ text: "{bpSearch>category}" }),
                                            new Text({ text: "{bpSearch>status}" })
                                        ]
                                    })
                                }
                            })
                        ]}).addStyleClass("sapUiSmallMargin")
                    ],
                    endButton: new Button({
                        text : "Cancel",
                        press: function () { this._oBpSearchDialog.close(); }.bind(this)
                    })
                });
                this._oBpSearchDialog.setModel(this._oBpSearchModel, "bpSearch");
                oView.addDependent(this._oBpSearchDialog);
            }
            this._oBpSearchModel.setProperty("/items", []);
            this._oBpSearchModel.setProperty("/query", "");
            this._oBpSearchModel.setProperty("/country", "");
            this._oBpSearchDialog.open();
        },

        _refreshBpSearch: function () {
            var oModel   = this.getOwnerComponent().getModel();
            var sQuery   = this._oBpSearchModel.getProperty("/query")   || "";
            var sCountry = this._oBpSearchModel.getProperty("/country") || "";
            this._oBpSearchModel.setProperty("/busy", true);
            oModel.bindContext("/SearchExistingBPs(...)")
                .setParameter("query",   sQuery)
                .setParameter("country", sCountry)
                .setParameter("category","")
                .execute()
                .then(function (oCtx) {
                    var aItems = oCtx ? (Array.isArray(oCtx) ? oCtx : []) : [];
                    this._oBpSearchModel.setProperty("/items", aItems);
                }.bind(this))
                .catch(function () {
                    // Fallback: return empty list rather than crash
                    this._oBpSearchModel.setProperty("/items", []);
                }.bind(this))
                .finally(function () {
                    this._oBpSearchModel.setProperty("/busy", false);
                }.bind(this));
        },

        _onBpSearchRowPress: function (oEvent) {
            var oCtx    = oEvent.getSource().getBindingContext("bpSearch");
            var sBpNum  = oCtx.getProperty("bp_number");
            var sName   = oCtx.getProperty("name");
            var sCat    = oCtx.getProperty("category");
            var sAg     = oCtx.getProperty("account_group");
            this._oBpSearchDialog.close();
            this._activateExtendMode(sBpNum, sName, sCat, sAg);
        },

        // Switch the form into EXTEND mode for the chosen existing BP.
        _activateExtendMode: function (sBpNum, sName, sCat, sAg) {
            var oRt = this._oRt;
            oRt.setProperty("/mode",      "EXTEND");
            oRt.setProperty("/started",   true);
            oRt.setProperty("/extendBp",  sBpNum + " \u2014 " + sName);
            oRt.setProperty("/catDisp",   sCat || "\u2014");
            oRt.setProperty("/bpAgDisp",  sAg  || "\u2014");
            oRt.setProperty("/subtitle",  "Extending BP " + sBpNum + " \u00b7 " + sName);
            oRt.setProperty("/status",    "Extend");

            // Store the minimal data we have; also fetch the full header
            oRt.setProperty("/extendBpData", { bp_number: sBpNum, name: sName, category: sCat, account_group: sAg });

            // Fetch the full data (for pre-filling fields)
            this._fetchExistingBpData(sBpNum);
            this._recomputeCanSave();
        },

        _fetchExistingBpData: function (sBpNum) {
            var oModel = this.getOwnerComponent().getModel();
            oModel.bindContext("/GetExistingBPData(...)")
                .setParameter("bp_number", sBpNum)
                .execute()
                .then(function (oResult) {
                    if (!oResult) return;
                    this._oRt.setProperty("/extendBpData", oResult);
                    // Pre-fill form values with existing BP data
                    this._prefillExtendValues(oResult);
                    // If roles are already selected, refresh the tabs (now with real data)
                    if ((this._oRt.getProperty("/roleKeys") || []).length) {
                        this._renderTabsForActiveRole();
                    }
                }.bind(this))
                .catch(function () { /* non-fatal — form still works without pre-fill */ });
        },

        // Pre-fill form values from the existing BP response.
        // Called in EXTEND mode so the user sees existing data in every field.
        _prefillExtendValues: function (oBpData) {
            if (!oBpData) return;
            var oFormModel = this.getView().getModel("form");
            var mCurrent   = oFormModel.getProperty("/values") || {};
            var mFill = {
                NAME1    : oBpData.name      || "",
                NAME2    : oBpData.name2     || "",
                COUNTRY  : oBpData.country   || "",
                CITY     : oBpData.city      || "",
                STREET   : oBpData.street    || "",
                TELEPHONE: oBpData.telephone || "",
                EMAIL    : oBpData.email     || ""
            };
            // Merge: only set if not already entered by the user
            Object.keys(mFill).forEach(function (k) {
                if (!mCurrent[k] && mFill[k]) { mCurrent[k] = mFill[k]; }
            });
            oFormModel.setProperty("/values", mCurrent);
        },

        // ── BP Role Value Help ────────────────────────────────────────
        onBpRoleValueHelp: function () {
            var oView = this.getView();
            if (!this._oRoleVHModel) {
                this._oRoleVHModel = new JSONModel({ items: [], selectedCount: 0 });
            }
            this._syncRoleVHItems();

            if (!this._oRoleVHDialog) {
                Fragment.load({
                    id        : oView.getId(),
                    name      : "mdm.portal.view.Fragment.BPRoleVHDialog",
                    controller: this
                }).then(function (oDialog) {
                    this._oRoleVHDialog = oDialog;
                    oView.addDependent(oDialog);
                    oDialog.setModel(this._oRoleVHModel, "roleVH");
                    oDialog.open();
                }.bind(this));
            } else {
                this._oRoleVHDialog.setModel(this._oRoleVHModel, "roleVH");
                var oSearch = this._oRoleVHDialog.getSubHeader().getContentMiddle()[0];
                if (oSearch) { oSearch.setValue(""); }
                this._syncRoleVHItems();
                this._oRoleVHDialog.open();
            }
        },

        _syncRoleVHItems: function () {
            var aAllItems = this.getView().getModel("roles").getProperty("/items") || [];
            var aKeys     = this._oRt.getProperty("/roleKeys") || [];
            var aItems    = aAllItems.map(function (item) {
                return Object.assign({}, item, { selected: aKeys.indexOf(item.key) >= 0 });
            });
            this._oRoleVHModel.setProperty("/items", aItems);
            this._oRoleVHModel.setProperty("/selectedCount", aKeys.length);
        },

        onRoleVHSearch: function (oEvent) {
            var sQuery    = (oEvent.getParameter("newValue") || "").toLowerCase();
            var aAllItems = this.getView().getModel("roles").getProperty("/items") || [];
            var aKeys     = this._oRt.getProperty("/roleKeys") || [];
            var aFiltered = (sQuery
                ? aAllItems.filter(function (o) {
                    return o.key.toLowerCase().includes(sQuery) ||
                           o.description.toLowerCase().includes(sQuery) ||
                           (o.scopeDisp || "").toLowerCase().includes(sQuery);
                  })
                : aAllItems
            ).map(function (item) {
                return Object.assign({}, item, { selected: aKeys.indexOf(item.key) >= 0 });
            });
            this._oRoleVHModel.setProperty("/items", aFiltered);
        },

        onRoleVHSelectionChange: function (oEvent) {
            var oListItem = oEvent.getParameter("listItem");
            var bSelected = oEvent.getParameter("selected");
            var sKey      = oListItem.getBindingContext("roleVH").getProperty("key");
            var aItems    = this._oRoleVHModel.getProperty("/items");
            var oItem     = aItems.find(function (i) { return i.key === sKey; });
            if (oItem) { oItem.selected = bSelected; }
            this._oRoleVHModel.setProperty("/items", aItems);
            this._oRoleVHModel.setProperty("/selectedCount",
                aItems.filter(function (i) { return i.selected; }).length);
        },

        onRoleVHRowPress: function (oEvent) {
            var oListItem = oEvent.getSource();
            var sKey      = oListItem.getBindingContext("roleVH").getProperty("key");
            var aItems    = this._oRoleVHModel.getProperty("/items");
            var oItem     = aItems.find(function (i) { return i.key === sKey; });
            if (oItem) {
                oItem.selected = !oItem.selected;
                this._oRoleVHModel.setProperty("/items", aItems);
                this._oRoleVHModel.setProperty("/selectedCount",
                    aItems.filter(function (i) { return i.selected; }).length);
            }
        },

        onRoleVHConfirm: function () {
            var aItems    = this._oRoleVHModel.getProperty("/items") || [];
            var aKeys     = aItems.filter(function (i) { return i.selected; })
                                  .map(function (i) { return i.key; });
            // Persist selected state to master roles model
            var aAllItems = this.getView().getModel("roles").getProperty("/items");
            aAllItems.forEach(function (item) {
                item.selected = aKeys.indexOf(item.key) >= 0;
            });
            this.getView().getModel("roles").setProperty("/items", aAllItems);
            this._oRoleVHDialog.close();
            this._onRoleKeysChanged(aKeys);
        },

        onRoleVHCancel: function () {
            this._oRoleVHDialog.close();
        },

        _onRoleKeysChanged: function (aKeys) {
            this._oRt.setProperty("/roleKeys", aKeys);

            if (!aKeys.length) {
                this._oRt.setProperty("/roleDisp", "\u2014");
                this._buildTabs([], []);
                this._recomputeCanSave();
                return;
            }

            this._resolvePrereqRoles(aKeys).then(function (aPairs) {
                var aResolved = aKeys.slice();
                aPairs.forEach(function (p) {
                    if (aResolved.indexOf(p.prerequisite) < 0) { aResolved.push(p.prerequisite); }
                });
                var aDisp = aKeys.slice();
                aResolved.forEach(function (k) {
                    if (aKeys.indexOf(k) < 0) { aDisp.push(k + " (prereq)"); }
                });
                this._oRt.setProperty("/roleDisp", aDisp.join(", "));
                this._buildTabs(aResolved, aKeys);
                this._recomputeCanSave();
            }.bind(this));
        },

        // Resolve auto-pull prerequisite roles for the selected roles, returned
        // as {role, prerequisite} pairs so each prerequisite can be folded into
        // the specific picked role that needed it.
        _resolvePrereqRoles: function (aKeys) {
            var oModel = this.getOwnerComponent().getModel();
            var aRoleFilters = aKeys.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oRolesFilter = aRoleFilters.length === 1
                ? aRoleFilters[0]
                : new Filter({ filters: aRoleFilters, and: false });
            var oFilter = new Filter({
                filters: [oRolesFilter, new Filter("auto_pull", FilterOperator.EQ, true)],
                and: true
            });
            return oModel.bindList("/BPRoleDependencies", null, null, [oFilter], {
                $select: "role_role_id,prerequisite_role_role_id,auto_pull"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                return aCtx.map(function (c) {
                    return {
                        role        : c.getProperty("role_role_id"),
                        prerequisite: c.getProperty("prerequisite_role_role_id")
                    };
                });
            }).catch(function () { return []; });
        },

        // ── Account Group Value Help ──────────────────────────────────
        onBpAgValueHelp: function () {
            var oView = this.getView();
            if (!this._oAgVHModel) {
                this._oAgVHModel = new JSONModel({ items: [] });
            }
            // Seed the VH list with all items (unfiltered)
            this._oAgVHModel.setProperty("/items",
                this.getView().getModel("ag").getProperty("/items"));

            if (!this._oAgVHDialog) {
                Fragment.load({
                    id         : oView.getId(),
                    name       : "mdm.portal.view.Fragment.AccountGroupVHDialog",
                    controller : this
                }).then(function (oDialog) {
                    this._oAgVHDialog = oDialog;
                    oView.addDependent(oDialog);
                    oDialog.setModel(this._oAgVHModel, "agVH");
                    oDialog.open();
                }.bind(this));
            } else {
                this._oAgVHDialog.setModel(this._oAgVHModel, "agVH");
                // Reset search field
                var oSearch = this._oAgVHDialog.getSubHeader().getContentMiddle()[0];
                if (oSearch) { oSearch.setValue(""); }
                this._oAgVHModel.setProperty("/items",
                    this.getView().getModel("ag").getProperty("/items"));
                this._oAgVHDialog.open();
            }
        },

        onAgVHSearch: function (oEvent) {
            var sQuery   = oEvent.getParameter("newValue").toLowerCase();
            var aAllItems = this.getView().getModel("ag").getProperty("/items") || [];
            var aFiltered = sQuery
                ? aAllItems.filter(function (o) {
                    return o.key.toLowerCase().includes(sQuery) ||
                           o.description.toLowerCase().includes(sQuery) ||
                           (o.type || "").toLowerCase().includes(sQuery);
                  })
                : aAllItems;
            this._oAgVHModel.setProperty("/items", aFiltered);
        },

        onAgVHSelect: function (oEvent) {
            // Fired either by table selectionChange or ColumnListItem press
            var oItem;
            var oSource = oEvent.getSource();
            if (oSource.isA("sap.m.Table")) {
                var oListItem = oEvent.getParameter("listItem");
                oItem = oListItem ? oListItem.getBindingContext("agVH").getObject() : null;
            } else {
                // ColumnListItem press
                oItem = oSource.getBindingContext("agVH")
                    ? oSource.getBindingContext("agVH").getObject()
                    : null;
            }
            if (!oItem) { return; }
            this._applyAgSelection(oItem.key);
            this._oAgVHDialog.close();
        },

        onAgVHCancel: function () {
            this._oAgVHDialog.close();
        },

        _applyAgSelection: function (sKey) {
            var oAg    = this._mAccountGroups[sKey];
            var aItems = this.getView().getModel("ag").getProperty("/items") || [];
            var oItem  = aItems.find(function (i) { return i.key === sKey; });
            var sDisp  = oItem ? oItem.text : sKey;

            this._oRt.setProperty("/bpAgId",   sKey);
            this._oRt.setProperty("/bpAgDisp",  sDisp);

            if (oAg) {
                var sNr      = oAg.number_range_id + " (" + oAg.assignment_mode + ")";
                var bExternal = oAg.assignment_mode === "EXTERNAL";
                this._oRt.setProperty("/numberRange",           sNr);
                this._oRt.setProperty("/nrDisp",                sNr);
                this._oRt.setProperty("/bpNumberEditable",      bExternal);
                this._oRt.setProperty("/bpNumberPlaceholder",   bExternal ? "Enter BP number" : "Generated on save");
                this._oRt.setProperty("/bpNumberHelp",          bExternal
                    ? "External numbering — enter the BP number."
                    : "Internal numbering — generated on save.");
            } else {
                this._oRt.setProperty("/numberRange", "\u2014");
                this._oRt.setProperty("/nrDisp",      "\u2014");
            }
            this._recomputeCanSave();
        },

        // ── Dynamic tab generation from the selected roles' fields ───
        // aResolvedRoles: picked roles + their auto-pulled prereq roles.
        //   All of these get their fields fetched and appear in the toggle bar.
        // aPickedRoles: only what the user explicitly selected — used to
        //   mark which bar buttons are "user-picked" vs "prereq".
        _buildTabs: function (aResolvedRoles, aPickedRoles) {
            var oTabs = this.byId("cbpTabs");
            oTabs.destroyItems();

            if (!aResolvedRoles.length) {
                this._oRt.setProperty("/hasRoles", false);
                this._oRt.setProperty("/activeRole", "");
                this._aAllAssignments = [];
                this._renderRoleBar([], []);
                return;
            }
            this._oRt.setProperty("/hasRoles", true);

            var oModel = this.getOwnerComponent().getModel();
            var aRoleFilters = aResolvedRoles.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oFilter = aRoleFilters.length === 1
                ? aRoleFilters[0]
                : new Filter({ filters: aRoleFilters, and: false });

            oModel.bindList("/BPRoleFields", null, [new Sorter("sequence")], [oFilter], {
                $expand: "field($select=field_id,description,data_type,display_type,length,source_table,main_group_group_id,sub_group_group_id;$expand=validation($select=validation_id,function_name,trigger_on,error_message,input_param_1,input_param_2,input_param_3))",
                $select: "role_role_id,field_field_id,field_status,sequence,read_only,default_value"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                this._aAllAssignments = aCtx.map(function (c) {
                    return {
                        role       : c.getProperty("role_role_id"),
                        field_id   : c.getProperty("field_field_id"),
                        description: c.getProperty("field/description") || c.getProperty("field_field_id"),
                        data_type  : c.getProperty("field/data_type") || "STRING",
                        display    : c.getProperty("field/display_type") || "INPUT",
                        sourceTable: c.getProperty("field/source_table") || "",
                        mainGroup  : c.getProperty("field/main_group_group_id") || "OTHER",
                        subGroup   : c.getProperty("field/sub_group_group_id") || "",
                        status     : c.getProperty("field_status"),
                        readOnly   : c.getProperty("read_only") === true,
                        defaultVal : c.getProperty("default_value") || "",
                        sequence   : c.getProperty("sequence") || 0,
                        valFn      : c.getProperty("field/validation/function_name") || "",
                        valTrigger : c.getProperty("field/validation/trigger_on") || "",
                        valMsg     : c.getProperty("field/validation/error_message") || "",
                        valParam1  : c.getProperty("field/validation/input_param_1") || "",
                        valParam2  : c.getProperty("field/validation/input_param_2") || ""
                    };
                });
                return this._fetchPrereqFields(aResolvedRoles);
            }.bind(this)).then(function () {
                this._setupActiveRole(aResolvedRoles);
                this._renderRoleBar(aResolvedRoles, aPickedRoles);
                this._renderTabsForActiveRole();
            }.bind(this)).catch(function (oErr) {
                MessageBox.error("Could not load fields for the selected roles: " +
                    (oErr && oErr.message || "error"));
            });
        },

        // Default the active role to a "general" (account_scope = BOTH) role when
        // one is present among the resolved roles, else the first one — mirroring
        // the wireframe. If the current active role is still in the resolved set
        // (e.g. roles changed but this one stayed selected), keep it as-is.
        _setupActiveRole: function (aRoleKeys) {
            var sCurrent = this._oRt.getProperty("/activeRole");
            if (sCurrent && aRoleKeys.indexOf(sCurrent) >= 0) { return; }

            var sGeneral = "";
            for (var i = 0; i < aRoleKeys.length; i++) {
                var oMeta = this._mRoleMeta[aRoleKeys[i]];
                if (oMeta && oMeta.account_scope === "BOTH") { sGeneral = aRoleKeys[i]; break; }
            }
            this._oRt.setProperty("/activeRole", sGeneral || aRoleKeys[0]);
        },

        // Fetch the prerequisite *fields* for every involved role and store them
        // in this._mRolePrereqFields[roleId] = [ plain-object per field ].
        // These are the fields the user must complete before the main tabs unlock.
        _fetchPrereqFields: function (aRoles) {
            if (!aRoles.length) {
                this._mRolePrereqFields = {};
                return Promise.resolve();
            }
            var oModel = this.getOwnerComponent().getModel();
            var aFilters = aRoles.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oFilter = aFilters.length === 1
                ? aFilters[0]
                : new Filter({ filters: aFilters, and: false });

            return oModel.bindList("/BPRolePrereqFields", null,
                [new Sorter("sequence")], [oFilter], {
                    $expand: "field($select=field_id,description,data_type,display_type,length,source_table)",
                    $select: "role_role_id,field_field_id,sequence"
                }
            ).requestContexts(0, 200).then(function (aCtx) {
                this._mRolePrereqFields = {};
                aCtx.forEach(function (c) {
                    var sRole = c.getProperty("role_role_id");
                    if (!this._mRolePrereqFields[sRole]) {
                        this._mRolePrereqFields[sRole] = [];
                    }
                    this._mRolePrereqFields[sRole].push({
                        field_id   : c.getProperty("field_field_id"),
                        description: c.getProperty("field/description") || c.getProperty("field_field_id"),
                        data_type  : c.getProperty("field/data_type") || "STRING",
                        display    : c.getProperty("field/display_type") || "INPUT",
                        sourceTable: c.getProperty("field/source_table") || "",
                        length     : c.getProperty("field/length") || 0,
                        status     : "REQUIRED",   // prereq fields are always required
                        readOnly   : false,
                        defaultVal : "",
                        sequence   : c.getProperty("sequence") || 0,
                        valFn: "", valTrigger: "", valMsg: "", valParam1: "", valParam2: ""
                    });
                }.bind(this));
            }.bind(this)).catch(function () {
                // Non-fatal: if the prereq endpoint fails, just proceed without gating
                this._mRolePrereqFields = {};
            }.bind(this));
        },

        // Role toggle bar — one button per resolved role (picked + auto-pulled prereqs).
        // Wireframe rule: hide the bar entirely when there is only one resolved role
        // (no need to switch). Auto-pulled prereq roles get a "prereq" visual tag.
        _renderRoleBar: function (aResolvedRoles, aPickedRoles) {
            var oBar    = this.byId("cbpRoleBar");
            var oLabel  = this.byId("cbpRoleBarLabel");
            oBar.destroyItems();

            // Hide bar if 0 or 1 resolved roles — nothing to switch between
            var bVisible = aResolvedRoles.length > 1;
            oBar.setVisible(bVisible);
            if (oLabel) { oLabel.setVisible(bVisible); }

            if (!bVisible) { return; }

            aResolvedRoles.forEach(function (k) {
                var oMeta    = this._mRoleMeta[k] || {};
                var bIsPrereq = aPickedRoles.indexOf(k) < 0;   // in resolved but not picked → auto-pulled
                oBar.addItem(new SegmentedButtonItem({
                    key : k,
                    text: k + " \u2014 " + (oMeta.description || k) + (bIsPrereq ? " (prereq)" : "")
                }));
            }.bind(this));
            oBar.setSelectedKey(this._oRt.getProperty("/activeRole"));
        },

        onActiveRoleChange: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oRt.setProperty("/activeRole", sKey);
            this._renderTabsForActiveRole();
        },

        _renderTabsForActiveRole: function () {
            var oTabs = this.byId("cbpTabs");
            oTabs.destroyItems();

            var sActive = this._oRt.getProperty("/activeRole");
            // Each role in the bar shows only its OWN assigned fields.
            // Prerequisite roles appear as separate tabs in the role bar —
            // switching to BUP001 shows BUP001's fields, not FLCU01's fields.
            var aCtx = this._aAllAssignments.filter(function (a) {
                return a.role === sActive;
            });

            // 1) Keep the strongest status per field (within one role each
            // field appears at most once, so this is mostly a pass-through).
            var mFields = {};
            aCtx.forEach(function (f) {
                if (f.status === "SUPPRESS") { return; }             // hidden from the form
                var oExisting = mFields[f.field_id];
                if (oExisting && STATUS_RANK[oExisting.status] >= STATUS_RANK[f.status]) { return; }
                mFields[f.field_id] = f;
            });

            // 2) Group by main group, then sub group.
            var mMain = {};
            Object.keys(mFields).forEach(function (sFid) {
                var f = mFields[sFid];
                (mMain[f.mainGroup] = mMain[f.mainGroup] || []).push(f);
            });

            // 3) Seed the form value model — preserve any values the user has already
            //    entered when switching role tabs; start new fields blank.
            //    default_value on the field assignment is stored as metadata only;
            //    it is NOT auto-populated here so nothing appears pre-filled without
            //    user action. To apply a default the admin should set it explicitly.
            var oFormModel = this.getView().getModel("form");
            var mExisting  = oFormModel.getProperty("/values") || {};
            var mValues    = {};
            Object.keys(mFields).forEach(function (sFid) {
                mValues[sFid] = mExisting[sFid] !== undefined ? mExisting[sFid] : "";
            });
            oFormModel.setProperty("/values", mValues);

            // 4) Order main groups by their configured sequence.
            var aMainIds = Object.keys(mMain).sort(function (a, b) {
                var sa = (this._mGroups[a] && this._mGroups[a].sequence) || 0;
                var sb = (this._mGroups[b] && this._mGroups[b].sequence) || 0;
                return sa - sb;
            }.bind(this));

            var iTotal = 0;
            this._aMainTabItems = [];     // reset for this render pass

            // ── Prerequisites tab (always first, when the role has prereq fields) ──
            var aPrereqFields = this._mRolePrereqFields[sActive] || [];
            if (aPrereqFields.length) {
                var sMode       = this._oRt.getProperty("/mode");
                var oBpData     = this._oRt.getProperty("/extendBpData");
                var bExtend     = sMode === "EXTEND" && !!oBpData;
                var oPrereqForm = this._buildPrereqForm(sActive, aPrereqFields, bExtend);

                var oPrereqBanner = new sap.m.MessageStrip({
                    text     : "Fill in the prerequisite fields below — the data tabs unlock once all are completed.",
                    type     : "Information",
                    showIcon : true
                });
                oPrereqBanner.addStyleClass("sapUiSmallMarginBottom");

                var oPrereqVBox = new VBox({ items: [oPrereqBanner] });

                if (bExtend) {
                    // In EXTEND mode, show the existing-instances strip above the form.
                    // The strip is built asynchronously after the tab renders.
                    var oExtStrip = new Panel({
                        id      : "idExtStrip_" + sActive,
                        visible : false,
                        content : []
                    });
                    oExtStrip.addStyleClass("sapUiSmallMarginBottom");
                    oPrereqVBox.addItem(oExtStrip);

                    // Async: load instances and populate the strip
                    this._loadAndRenderExtStrip(sActive, oExtStrip, aPrereqFields, oPrereqForm);
                }

                oPrereqVBox.addItem(new Panel({
                    headerText  : "Required before proceeding (" + aPrereqFields.length +
                                  " field" + (aPrereqFields.length > 1 ? "s" : "") + ")",
                    expandable  : false,
                    expanded    : true,
                    content     : [oPrereqForm]
                }).addStyleClass("sapUiNoContentPadding"));

                oTabs.addItem(new IconTabFilter({
                    key    : "__prereqs",
                    text   : "Prerequisites",
                    icon   : "sap-icon://key",
                    count  : String(aPrereqFields.length),
                    content: [oPrereqVBox]
                }));
            }

            aMainIds.forEach(function (sMain) {
                var oGrpMeta = this._mGroups[sMain] || {};
                var aFields  = mMain[sMain].sort(function (a, b) { return a.sequence - b.sequence; });
                iTotal += aFields.length;

                var aBuckets   = [];
                var mBucketIdx = {};
                aFields.forEach(function (f) {
                    var sKey = f.subGroup || f.mainGroup;
                    if (mBucketIdx[sKey] === undefined) {
                        mBucketIdx[sKey] = aBuckets.length;
                        aBuckets.push({ key: sKey, fields: [] });
                    }
                    aBuckets[mBucketIdx[sKey]].fields.push(f);
                });

                var oTabContent = new VBox();
                aBuckets.forEach(function (oBucket, iIdx) {
                    var oForm = new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4, labelSpanS: 12,
                        columnsXL: 2, columnsL: 2, columnsM: 1
                    });
                    oBucket.fields.forEach(function (f) {
                        oForm.addContent(new Label({ text: f.description, required: f.status === "REQUIRED" }));
                        oForm.addContent(this._fieldControl(f));
                    }.bind(this));

                    var oSubMeta = this._mGroups[oBucket.key] || {};
                    var oPanel = new Panel({
                        headerText: (oSubMeta.description || oBucket.key) + " (" + oBucket.fields.length + ")",
                        expandable: true, expanded: iIdx === 0, content: [oForm]
                    });
                    oPanel.addStyleClass("sapUiSmallMarginBottom");
                    oPanel.addStyleClass("sapUiNoContentPadding");
                    oTabContent.addItem(oPanel);
                }.bind(this));

                var oTab = new IconTabFilter({
                    key: sMain, text: oGrpMeta.description || sMain,
                    count: String(aFields.length), icon: oGrpMeta.icon || "sap-icon://form",
                    content: [oTabContent]
                });
                this._aMainTabItems.push(oTab);
                oTabs.addItem(oTab);
            }.bind(this));

            this._oRt.setProperty("/preqDisp", iTotal + " field" + (iTotal !== 1 ? "s" : ""));

            var oAttsTab = this._buildAttachmentsTab();
            this._aMainTabItems.push(oAttsTab);
            oTabs.addItem(oAttsTab);

            // Gate main tabs on first render — unlock immediately if all prereqs
            // are already filled (e.g. user switched roles and came back).
            this._checkAndGateTabs();
        },

        // Build the prerequisite SimpleForm with liveChange gating.
        // In extend+edit mode, prereq fields are rendered read-only (locked).
        _buildPrereqForm: function (sRoleId, aPrereqFields, bExtend) {
            var oForm = new SimpleForm({
                editable: true,
                layout: "ResponsiveGridLayout",
                labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4, labelSpanS: 12,
                columnsXL: 2, columnsL: 2, columnsM: 1
            });
            aPrereqFields.forEach(function (f) {
                // In EXTEND + edit mode, prereq fields are locked (they identify the instance)
                var bLocked = bExtend
                    && this._oRt.getProperty("/roleInstanceMode/" + sRoleId) === "edit"
                    && typeof this._oRt.getProperty("/roleInstance/" + sRoleId) === "number";
                var fClone  = Object.assign({}, f, { readOnly: bLocked });
                oForm.addContent(new Label({ text: f.description, required: !bLocked }));
                var oCtrl = this._fieldControl(fClone);
                if (!bLocked) {
                    var fnCheck = function () { setTimeout(this._checkAndGateTabs.bind(this), 0); }.bind(this);
                    if (oCtrl.attachChange)     { oCtrl.attachChange(fnCheck); }
                    if (oCtrl.attachLiveChange) { oCtrl.attachLiveChange(fnCheck); }
                }
                oForm.addContent(oCtrl);
            }.bind(this));
            return oForm;
        },

        // In EXTEND mode: fetch existing instances for the active role, then
        // populate the ext-strip panel above the prereq form.
        _loadAndRenderExtStrip: function (sRoleId, oStripPanel, aPrereqFields, oPrereqForm) {
            var oModel  = this.getOwnerComponent().getModel();
            var oBpData = this._oRt.getProperty("/extendBpData");
            if (!oBpData || !oBpData.bp_number) return;

            oModel.bindContext("/GetBPRoleInstances(...)")
                .setParameter("bp_number", oBpData.bp_number)
                .setParameter("role_id",   sRoleId)
                .execute()
                .then(function (aInstances) {
                    var aInst = Array.isArray(aInstances) ? aInstances : [];
                    this._mRoleInstances = this._mRoleInstances || {};
                    this._mRoleInstances[sRoleId] = aInst;

                    // If no instances → this is a new combination; default to "new"
                    if (!aInst.length) {
                        this._oRt.setProperty("/roleInstance/" + sRoleId, "new");
                        return;
                    }
                    // Show the strip
                    this._renderExtStrip(sRoleId, aInst, oStripPanel, aPrereqFields, oPrereqForm);
                }.bind(this))
                .catch(function () {
                    // Non-fatal — just treat as a new combination
                    this._oRt.setProperty("/roleInstance/" + sRoleId, "new");
                }.bind(this));
        },

        // Render the strip that shows how many existing combinations the BP already
        // has for this role, with "Show extensions" and "New combination" buttons.
        _renderExtStrip: function (sRoleId, aInstances, oStripPanel, aPrereqFields, oPrereqForm) {
            var oRt      = this._oRt;
            var iCount   = aInstances.length;
            var sMeta    = oRt.getProperty("/mRoleMeta/" + sRoleId) || {};
            var sRoleDesc = (this._mRoleMeta[sRoleId] || {}).description || sRoleId;
            var iSel     = oRt.getProperty("/roleInstance/" + sRoleId);
            var sInstMode= oRt.getProperty("/roleInstanceMode/" + sRoleId) || "edit";

            var sStatus;
            if (iSel === "new") {
                sStatus = "Creating a new combination. " + iCount + " existing combination(s) on this BP.";
            } else if (typeof iSel === "number" && sInstMode === "edit") {
                var oInst = aInstances.find(function (i) { return i.instance_no === iSel; });
                sStatus = "Editing existing combination: " + ((oInst && oInst.key_label) || "—");
            } else if (typeof iSel === "number" && sInstMode === "copy") {
                var oInstC = aInstances.find(function (i) { return i.instance_no === iSel; });
                sStatus = "Copying as template from: " + ((oInstC && oInstC.key_label) || "—") + ". Change the key field(s) to save as a new combination.";
            } else {
                sStatus = iCount + " existing combination(s) for this BP and role. Choose one to edit, copy, or create a new one.";
            }

            oStripPanel.destroyContent();
            oStripPanel.addContent(new HBox({
                alignItems: "Center",
                items: [
                    new core.Icon({ src: "sap-icon://detail-view", size: "1rem",
                        color: "var(--sapInformativeColor)" }).addStyleClass("sapUiSmallMarginEnd"),
                    new VBox({ items: [
                        new sap.m.Title({ text: sRoleId + " — " + sRoleDesc, level: "H6" }),
                        new Text({ text: sStatus })
                    ]}),
                    new sap.m.ToolbarSpacer(),
                    new Button({
                        text : "Show extensions (" + iCount + ")",
                        type : "Transparent",
                        icon : "sap-icon://list",
                        press: function () {
                            this._openRoleInstancesDialog(sRoleId, aInstances, aPrereqFields, oPrereqForm, oStripPanel);
                        }.bind(this)
                    }),
                    (typeof iSel === "number" ? new Button({
                        text : "New combination",
                        type : "Transparent",
                        icon : "sap-icon://add",
                        press: function () {
                            oRt.setProperty("/roleInstance/" + sRoleId, "new");
                            oRt.setProperty("/roleInstanceMode/" + sRoleId, "edit");
                            this._clearPrereqValues(sRoleId, aPrereqFields);
                            this._refreshPrereqForm(sRoleId, aPrereqFields, oPrereqForm, oStripPanel, aInstances);
                        }.bind(this)
                    }) : null)
                ].filter(Boolean)
            }).addStyleClass("sapUiSmallMarginBeginEnd sapUiSmallMarginTopBottom"));

            oStripPanel.setVisible(true);
        },

        // Open the "Existing extensions" dialog for a role — lists all saved
        // prerequisite combinations with Edit / Copy as Template actions per row.
        _openRoleInstancesDialog: function (sRoleId, aInstances, aPrereqFields, oPrereqForm, oStripPanel) {
            var oView = this.getView();
            if (this._oRoleInstDialog) { this._oRoleInstDialog.destroy(); }

            var oRt       = this._oRt;
            var oBpData   = oRt.getProperty("/extendBpData");
            var sRoleDesc = (this._mRoleMeta[sRoleId] || {}).description || sRoleId;

            // Build a table row for each instance
            var aRows = aInstances.map(function (inst, idx) {
                var iInstNo  = inst.instance_no;
                var iSelNow  = oRt.getProperty("/roleInstance/" + sRoleId);
                var sModNow  = oRt.getProperty("/roleInstanceMode/" + sRoleId) || "edit";
                var bSelEdit = (iSelNow === iInstNo && sModNow === "edit");
                var bSelCopy = (iSelNow === iInstNo && sModNow === "copy");
                return new ColumnListItem({
                    cells: [
                        new Text({ text: inst.key_label || "\u2014" }),
                        new HBox({ items: [
                            new Button({
                                text  : bSelEdit ? "Editing \u2713" : "Edit",
                                type  : bSelEdit ? "Emphasized" : "Default",
                                press : function () {
                                    this._pickRoleInstance(sRoleId, iInstNo, "edit", aInstances, aPrereqFields, oPrereqForm, oStripPanel);
                                    this._oRoleInstDialog.close();
                                }.bind(this)
                            }).addStyleClass("sapUiTinyMarginEnd"),
                            new Button({
                                text  : bSelCopy ? "Copying \u2713" : "Copy as template",
                                type  : bSelCopy ? "Emphasized" : "Default",
                                press : function () {
                                    this._pickRoleInstance(sRoleId, iInstNo, "copy", aInstances, aPrereqFields, oPrereqForm, oStripPanel);
                                    this._oRoleInstDialog.close();
                                }.bind(this)
                            })
                        ]})
                    ]
                });
            }.bind(this));

            this._oRoleInstDialog = new sap.m.Dialog({
                title       : "Existing extensions — " + sRoleId + " on BP " + (oBpData ? oBpData.bp_number : ""),
                contentWidth: "40rem",
                content     : [
                    new sap.m.MessageStrip({
                        text     : "BP " + (oBpData ? oBpData.bp_number : "") + " has " + aInstances.length +
                                   " existing extension(s) for " + sRoleDesc + ". " +
                                   "Edit: load and lock the key fields. Copy: load and leave key fields editable.",
                        type     : "Information",
                        showIcon : true
                    }).addStyleClass("sapUiSmallMargin"),
                    new Table({
                        columns: [
                            new Column({ header: new Label({ text: "Key combination" }) }),
                            new Column({ header: new Label({ text: "Action" }), hAlign: "End" })
                        ],
                        items: aRows
                    })
                ],
                endButton: new Button({
                    text : "Close",
                    press: function () { this._oRoleInstDialog.close(); }.bind(this)
                })
            });
            oView.addDependent(this._oRoleInstDialog);
            this._oRoleInstDialog.open();
        },

        // Apply an instance selection: load its field values into the form model.
        // mode = "edit"  → lock prereq fields (they are the identity key).
        // mode = "copy"  → keep prereq fields editable (user must change them to create a new combo).
        _pickRoleInstance: function (sRoleId, iInstNo, sMode, aInstances, aPrereqFields, oPrereqForm, oStripPanel) {
            var oRt = this._oRt;
            oRt.setProperty("/roleInstance/" + sRoleId, iInstNo);
            oRt.setProperty("/roleInstanceMode/" + sRoleId, sMode);

            var oInst = aInstances.find(function (i) { return i.instance_no === iInstNo; });
            if (oInst) {
                // Load all saved field values into the form model
                var mLoaded = {};
                try { mLoaded = JSON.parse(oInst.field_values || "{}"); } catch (e) {}
                var oFormModel = this.getView().getModel("form");
                var mCurrent   = oFormModel.getProperty("/values") || {};
                Object.assign(mCurrent, mLoaded);

                // In copy mode: clear the prereq field values so user enters new ones
                if (sMode === "copy") {
                    aPrereqFields.forEach(function (f) { delete mCurrent[f.field_id]; });
                }
                oFormModel.setProperty("/values", mCurrent);
            }

            // Rebuild the prereq form to honour the lock/unlock state
            this._refreshPrereqForm(sRoleId, aPrereqFields, oPrereqForm, oStripPanel, aInstances);
            setTimeout(this._checkAndGateTabs.bind(this), 0);
            MessageToast.show(sMode === "copy"
                ? "Copied as template — change the key field(s) to save as a new combination."
                : "Loaded existing combination for editing.");
        },

        // Clear the prerequisite field values for a role from the form model.
        _clearPrereqValues: function (sRoleId, aPrereqFields) {
            var oFormModel = this.getView().getModel("form");
            var mCurrent   = oFormModel.getProperty("/values") || {};
            aPrereqFields.forEach(function (f) { delete mCurrent[f.field_id]; });
            oFormModel.setProperty("/values", mCurrent);
        },

        // Rebuild only the prereq form content (lock/unlock) and refresh the strip.
        _refreshPrereqForm: function (sRoleId, aPrereqFields, oPrereqForm, oStripPanel, aInstances) {
            var bExtend = this._oRt.getProperty("/mode") === "EXTEND"
                && !!this._oRt.getProperty("/extendBpData");
            // Rebuild form content with correct lock state
            oPrereqForm.destroyContent();
            aPrereqFields.forEach(function (f) {
                var bLocked = bExtend
                    && this._oRt.getProperty("/roleInstanceMode/" + sRoleId) === "edit"
                    && typeof this._oRt.getProperty("/roleInstance/" + sRoleId) === "number";
                var fClone = Object.assign({}, f, { readOnly: bLocked });
                oPrereqForm.addContent(new Label({ text: f.description, required: !bLocked }));
                var oCtrl = this._fieldControl(fClone);
                if (!bLocked) {
                    var fnCheck = function () { setTimeout(this._checkAndGateTabs.bind(this), 0); }.bind(this);
                    if (oCtrl.attachChange)     { oCtrl.attachChange(fnCheck); }
                    if (oCtrl.attachLiveChange) { oCtrl.attachLiveChange(fnCheck); }
                }
                oPrereqForm.addContent(oCtrl);
            }.bind(this));
            // Refresh the strip text
            if (aInstances && aInstances.length) {
                this._renderExtStrip(sRoleId, aInstances, oStripPanel, aPrereqFields, oPrereqForm);
            }
        },

        // Checks whether every prerequisite field for the active role has a value,
        // then enables or disables all main tabs accordingly.
        _checkAndGateTabs: function () {
            var bComplete = this._arePrereqsComplete();
            this._aMainTabItems.forEach(function (oTab) {
                oTab.setEnabled(bComplete);
            });
            // If prereqs just became complete, auto-navigate to the first main tab.
            if (bComplete && this._aMainTabItems.length) {
                var oTabs = this.byId("cbpTabs");
                var sFirst = this._aMainTabItems[0].getKey();
                if (oTabs.getSelectedKey() === "__prereqs") {
                    oTabs.setSelectedKey(sFirst);
                }
            }
        },

        _arePrereqsComplete: function () {
            var sActive = this._oRt.getProperty("/activeRole");
            var aPrereqs = this._mRolePrereqFields[sActive] || [];
            if (!aPrereqs.length) { return true; }   // no prereqs → always unlocked
            var mValues = this.getView().getModel("form").getProperty("/values") || {};
            return aPrereqs.every(function (f) {
                var v = mValues[f.field_id];
                return v !== undefined && v !== null && String(v).trim() !== "";
            });
        },

        // ── Attachments tab ─────────────────────────────────────────────
        // Client-side only for now: captures real file name/size via the
        // browser's native picker, but there is no backend entity/endpoint
        // yet to actually persist or upload these when the BP is saved.
        _buildAttachmentsTab: function () {
            if (!this._oAttsModel) {
                this._oAttsModel = new JSONModel({ items: [] });
                this.getView().setModel(this._oAttsModel, "atts");
            }
            var aExisting = this._oAttsModel.getProperty("/items");

            var oUploader = new FileUploader({
                buttonOnly: true,
                buttonText: "Browse Files",
                icon: "sap-icon://upload",
                multiple: true,
                change: this._onFilesSelected.bind(this)
            });
            oUploader.addStyleClass("sapUiSmallMarginBottom");

            var oTable = new Table({
                noDataText: "No attachments yet.",
                columns: [
                    new Column({ header: new Label({ text: "File" }) }),
                    new Column({ header: new Label({ text: "Size" }), hAlign: "End", width: "6rem" }),
                    new Column({ width: "3rem", hAlign: "End" })
                ],
                items: {
                    path: "atts>/items",
                    template: new ColumnListItem({
                        cells: [
                            new Text({ text: "{atts>name}" }),
                            new Text({ text: "{atts>size}" }),
                            new Button({
                                icon: "sap-icon://decline",
                                type: "Transparent",
                                tooltip: "Remove",
                                press: this._onRemoveAttachment.bind(this)
                            })
                        ]
                    })
                }
            });

            var oIntro = new Text({
                text: "Attach supporting documents for this request — e.g. company registration, VAT certificate, signed authorisation."
            });
            oIntro.addStyleClass("sapUiSmallMarginBottom");

            var oContent = new VBox({
                items: [oIntro, oUploader, oTable]
            });
            oContent.addStyleClass("sapUiSmallMargin");

            this._oAttachmentsTab = new IconTabFilter({
                key  : "__attachments",
                text : "Attachments",
                icon : "sap-icon://attachment",
                count: aExisting.length ? String(aExisting.length) : "",
                content: [oContent]
            });
            return this._oAttachmentsTab;
        },

        _onFilesSelected: function (oEvent) {
            var aFiles = oEvent.getParameter("files");
            if (!aFiles || !aFiles.length) { return; }
            var aItems = this._oAttsModel.getProperty("/items").slice();
            for (var i = 0; i < aFiles.length; i++) {
                aItems.push({ name: aFiles[i].name, size: this._formatFileSize(aFiles[i].size) });
            }
            this._oAttsModel.setProperty("/items", aItems);
            this._oAttachmentsTab.setCount(String(aItems.length));
        },

        _onRemoveAttachment: function (oEvent) {
            var sPath = oEvent.getSource().getBindingContext("atts").getPath();
            var iIdx  = parseInt(sPath.split("/").pop(), 10);
            var aItems = this._oAttsModel.getProperty("/items").slice();
            aItems.splice(iIdx, 1);
            this._oAttsModel.setProperty("/items", aItems);
            this._oAttachmentsTab.setCount(aItems.length ? String(aItems.length) : "");
        },

        _formatFileSize: function (iBytes) {
            if (iBytes < 1024) { return iBytes + " B"; }
            if (iBytes < 1024 * 1024) { return Math.round(iBytes / 1024) + " KB"; }
            return (iBytes / (1024 * 1024)).toFixed(1) + " MB";
        },

        // ── Validation engine ────────────────────────────────────────
        // Runs the function referenced by the ValidationRule linked to a field.
        // Returns null when the value is valid, an error string when it's not.
        _runValidation: function (f, sValue) {
            if (!f.valFn) { return null; }
            var v = (sValue === undefined || sValue === null) ? "" : String(sValue);

            switch (f.valFn) {
                case "checkRequired":
                    return v.trim() ? null : (f.valMsg || "This field is required.");

                case "checkNumeric":
                    return /^-?\d+(\.\d+)?$/.test(v.trim()) ? null
                        : (f.valMsg || "Only numeric values are allowed.");

                case "checkEmailFormat":
                    if (!v.trim()) { return null; }   // empty = let Required handle it
                    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null
                        : (f.valMsg || "Invalid email format.");

                case "checkDateRange":
                    if (!v.trim()) { return null; }
                    var oDate = new Date(v);
                    var oToday = new Date();
                    oToday.setHours(0, 0, 0, 0);
                    if (f.valParam1 === "today" && oDate < oToday) {
                        return f.valMsg || "Date must not be in the past.";
                    }
                    return null;

                default:
                    return null;   // unknown function — pass silently
            }
        },

        // Build the right input control for a field's display type.
        _fieldControl: function (f) {
            var sPath = "{form>/values/" + f.field_id + "}";
            var bEditable = !f.readOnly;

            if (f.display === "CHECKBOX" || f.data_type === "BOOLEAN") {
                return new CheckBox({ selected: sPath, editable: bEditable });
            }
            if (f.display === "DATEPICKER" || f.display === "DATE_PICKER" || f.data_type === "DATE") {
                return new DatePicker({ value: sPath, editable: bEditable, width: "100%" });
            }
            if (f.display === "DROPDOWN" || f.display === "SEARCH_HELP") {
                var sSource    = (this._mFieldSource && this._mFieldSource[f.field_id]) || f.sourceTable;
                var sEntitySet = SOURCE_TO_LOOKUP[sSource];
                if (sEntitySet) {
                    // A reference list backs this field -> real dropdown of values.
                    var oCombo = new ComboBox({
                        selectedKey: sPath, editable: bEditable, width: "100%",
                        placeholder: "Select…"
                    });
                    this._loadValueList(sEntitySet).then(function (aVals) {
                        aVals.forEach(function (v) {
                            oCombo.addItem(new Item({ key: v.code, text: v.text }));
                        });
                    }).catch(function () { /* leave empty on load failure */ });
                    return oCombo;
                }
                if (f.display === "DROPDOWN") {
                    // Configured as a dropdown but no value list is mapped yet —
                    // still render a dropdown control (empty) rather than a textbox.
                    return new ComboBox({
                        selectedKey: sPath, editable: bEditable, width: "100%",
                        placeholder: "No value list configured"
                    });
                }
                // SEARCH_HELP without a mapped list -> value-help input.
                return new Input({
                    value: sPath, editable: bEditable, width: "100%",
                    showValueHelp: true,
                    valueHelpRequest: function () { MessageToast.show("Value help — coming soon"); }
                });
            }
            var oInput = new Input({
                value: sPath, editable: bEditable, width: "100%",
                type: f.data_type === "INTEGER" || f.data_type === "DECIMAL" ? "Number" : "Text",
                maxLength: f.length || 0
            });
            // Apply FIELD-trigger validation live as the user types.
            if (f.valFn && f.valTrigger === "FIELD") {
                oInput.attachLiveChange(function (oEv) {
                    var sVal = oEv.getParameter("value");
                    var sErr = this._runValidation(f, sVal);
                    oEv.getSource().setValueState(sErr ? "Error" : "None");
                    oEv.getSource().setValueStateText(sErr || "");
                }.bind(this));
            }
            return oInput;
        },

        // Load (and cache) a reference list's values for dropdowns.
        _loadValueList: function (sEntitySet) {
            this._mValueCache = this._mValueCache || {};
            if (this._mValueCache[sEntitySet]) { return this._mValueCache[sEntitySet]; }

            var oModel = this.getOwnerComponent().getModel();
            var p = oModel.bindList("/" + sEntitySet, null, [new Sorter("code")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 1000).then(function (aCtx) {
                return aCtx.map(function (c) {
                    var sCode = c.getProperty("code");
                    return { code: sCode, text: sCode + " — " + (c.getProperty("description") || "") };
                });
            });
            this._mValueCache[sEntitySet] = p;
            return p;
        },

        // ── Save / cancel ────────────────────────────────────────────
        _recomputeCanSave: function () {
            var bOk = this._oRt.getProperty("/started")
                && (this._oRt.getProperty("/roleKeys") || []).length > 0
                && !!this._oRt.getProperty("/bpAgId");
            this._oRt.setProperty("/canSave", bOk);
        },

        onSaveDraft: function () {
            // Persisting to CRHeader/CRFieldValue is the next build step; this
            // confirms the form state is captured correctly in the meantime.
            MessageToast.show("Saved as draft (request persistence is the next step).");
        },

        onSaveCreate: function () {
            var aMissing = this._validateRequired();
            if (aMissing.length) {
                MessageBox.warning("Please complete the required fields:\n\n" + aMissing.join("\n"));
                return;
            }
            MessageToast.show("Validated — submitting to the approval workflow is the next step.");
        },

        _validateRequired: function () {
            var aErrors = [];
            var oValues = this.getView().getModel("form").getProperty("/values") || {};

            // Validate all assignments across every resolved role (picked + prereqs).
            // _aAllAssignments already contains fields from all resolved roles.
            var mActive = {};
            this._aAllAssignments.forEach(function (a) {
                if (a.status === "SUPPRESS") { return; }
                var oEx = mActive[a.field_id];
                if (oEx && STATUS_RANK[oEx.status] >= STATUS_RANK[a.status]) { return; }
                mActive[a.field_id] = a;
            });

            Object.keys(mActive).forEach(function (sFid) {
                var f    = mActive[sFid];
                var sVal = oValues[sFid];
                var sStr = (sVal === undefined || sVal === null) ? "" : String(sVal);

                if (f.status === "REQUIRED" && !sStr.trim()) {
                    aErrors.push("\u2022 " + f.description + " is required.");
                    return;
                }
                if (f.valFn && f.valTrigger === "SAVE" && sStr.trim()) {
                    var sErr = this._runValidation(f, sVal);
                    if (sErr) { aErrors.push("\u2022 " + f.description + ": " + sErr); }
                }
            }.bind(this));

            return aErrors;
        },

        onCancel: function () {
            var bDirty = this._oRt.getProperty("/started");
            var fnGo = function () {
                this._onRouteMatched();
                this.getOwnerComponent().getRouter().navTo("fieldMaster");
            }.bind(this);
            if (bDirty) {
                MessageBox.confirm("Discard this request?", {
                    onClose: function (sAction) { if (sAction === MessageBox.Action.OK) { fnGo(); } }
                });
            } else {
                fnGo();
            }
        }
    });
});