sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox
) {
    "use strict";

    return Controller.extend("mdm.portal.controller.ValidationRuleDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                isNew       : false,
                isDirty     : false,
                selectedTab : "general",
                usageCount  : "0"
            });
            this.getView().setModel(this._oViewModel, "view");
            this.getView().setModel(new JSONModel({ items: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("validationRuleDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sRaw = decodeURIComponent(oEvent.getParameter("arguments").validationId);
            var sId = (sRaw === "NEW") ? sRaw : sRaw.toUpperCase();

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this._oViewModel.setProperty("/usageCount", "0");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setProperty("/items", []);
            var oAttrUsage = this.byId("attrUsage");
            if (oAttrUsage) { oAttrUsage.setText(""); }

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindRule(sId);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindRule: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/ValidationRules('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: { $$updateGroupId: "validationUpdate" },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load validation rule: " + (oError.message || "Unknown error"));
                            return;
                        }
                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Validation rule not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (!oData) { return; }
                            this._refreshHeader(oData);
                            var oSel = this.byId("selTrigger");
                            if (oSel) { oSel.setSelectedKey(oData.trigger_on || ""); }
                            // Load usage count eagerly, right when the record loads
                            // — not lazily on tab-select.
                            this._loadUsage();
                        }.bind(this));
                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();
            var oListBinding = oModel.bindList("/ValidationRules", null, [], [], {
                $$updateGroupId: "validationUpdate"
            });
            var oContext = oListBinding.create({
                validation_id : "",
                description   : "",
                function_name : "",
                input_param_1 : null,
                input_param_2 : null,
                input_param_3 : null,
                trigger_on    : "FIELD",
                error_message : ""
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ validation_id: "", function_name: "", trigger_on: "FIELD" });
            this.byId("inId").setEditable(true);
            this.byId("selTrigger").setSelectedKey("FIELD");
        },

        // ── Header refresh ────────────────────────────────────────────
        _refreshHeader: function (oData) {
            var sId = oData.validation_id || "";
            var sFn = oData.function_name || "";
            var sTitle = sId ? (sId + (sFn ? " — " + sFn : "")) : "New Validation Rule";

            var oTitle = this.byId("pageTitle");
            if (oTitle) { oTitle.setText(sTitle); }

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) {
                oBreadcrumb.setCurrentLocationText(sId || "New Validation Rule");
            }
            var oSubtitle = this.byId("pageSubtitle");
            if (oSubtitle) { oSubtitle.setText("Validation Rule"); }

            var sTrigger = oData.trigger_on === "SAVE" ? "On Save" :
                           oData.trigger_on === "FIELD" ? "On Field Change" : "\u2014";
            var oAttrTrigger = this.byId("attrTrigger");
            if (oAttrTrigger) { oAttrTrigger.setText(sTrigger); }
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "usage") { this._loadUsage(); }
        },

        // ── Linked Fields tab ────────────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("validation_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                new Filter("validation_validation_id", FilterOperator.EQ, sId)
            ], {
                $select: "field_id,description,data_type,active,main_group_group_id,sub_group_group_id,validation_validation_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                // Guard against the view (or this control specifically) having
                // been torn down while this async request was in flight — e.g.
                // the user navigated away or switched to a different rule
                // right after selecting this tab. Without this check,
                // this.byId("attrUsage") can return undefined here and crash
                // with "Cannot read properties of undefined (reading 'setText')".
                var oView = this.getView();
                if (!oView || oView.bIsDestroyed) { return; }

                var aItems = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_id"),
                        description : c.getProperty("description"),
                        data_type   : c.getProperty("data_type"),
                        main_group  : c.getProperty("main_group_group_id"),
                        sub_group   : c.getProperty("sub_group_group_id"),
                        active      : c.getProperty("active")
                    };
                });
                oView.getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));

                var oAttrUsage = this.byId("attrUsage");
                if (oAttrUsage) {
                    oAttrUsage.setText(aItems.length + " field" + (aItems.length !== 1 ? "s" : ""));
                }
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load linked fields: " + e.message);
            });
        },

        onUsageRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        onUsageLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId.toLowerCase())
            });
        },

        // ── Function value help (stub) ───────────────────────────────
        onFunctionValueHelp: function () {
            MessageToast.show("Function search help — connect to the published CAP validation functions.");
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId      = this.byId("inId").getValue().trim().toUpperCase();
            var sFn      = this.byId("inFunction").getValue().trim();
            var sErrMsg  = this.byId("inErrorMessage").getValue().trim();
            var sTrigger = this.byId("selTrigger").getSelectedKey();

            if (!sId) {
                MessageBox.error("Validation Name is required.");
                return;
            }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Validation Name must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sFn) {
                MessageBox.error("Function Name is required.");
                return;
            }
            if (!sTrigger) {
                MessageBox.error("Trigger is required.");
                return;
            }
            if (!sErrMsg) {
                MessageBox.error("Error Message is required.");
                return;
            }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                // function_name, description, error_message, input_param_* are
                // two-way bound. Only set the key (on create) and the Select value.
                if (bIsNew) {
                    oCtx.setProperty("validation_id", sId);
                }
                oCtx.setProperty("trigger_on", sTrigger);
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("validationUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Validation rule saved successfully.");

                    if (bWasCreated) {
                        // Delay slightly so the toast actually paints before the
                        // route change tears the page down.
                        this._oCreateListBinding = null;
                        setTimeout(this.onNavBack.bind(this), 300);
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("validationUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Copy ─────────────────────────────────────────────────────
        onCopy: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) {
                MessageToast.show("No validation rule selected to copy.");
                return;
            }
            this.getOwnerComponent().getModel().resetChanges("validationUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/ValidationRules", null, [], [], {
                    $$updateGroupId: "validationUpdate"
                });
                var oNewCtx = oListBinding.create({
                    validation_id : "",
                    description   : oData.description ? oData.description + " (Copy)" : "",
                    function_name : oData.function_name,
                    input_param_1 : oData.input_param_1,
                    input_param_2 : oData.input_param_2,
                    input_param_3 : oData.input_param_3,
                    trigger_on    : oData.trigger_on,
                    error_message : oData.error_message
                });
                this._oCreateListBinding = oListBinding;
                // Unbind the source record's object binding (set by the _bind* view
                // binding) before switching context; an object binding overrides
                // setBindingContext, otherwise the copy never appears.
                this.getView().unbindObject();
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this.byId("inId").setEditable(true);
                this.byId("selTrigger").setSelectedKey(oData.trigger_on || "FIELD");

                this._refreshHeader({
                    validation_id: "",
                    function_name: oData.function_name,
                    trigger_on   : oData.trigger_on
                });

                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Rule copied — enter a new Validation Name and press Save.");
            }.bind(this));
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("validationRules");
        }
    });
});