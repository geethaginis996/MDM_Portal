sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    MessageToast,
    MessageBox,
    DateFormat,
  ) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.FieldMasterDetail", {
      // ── Lifecycle ────────────────────────────────────────────────

      onInit: function () {
        this._oViewModel = new JSONModel({
          busy: false,
          isNew: false,
          isDirty: false,
          selectedTab: "general",
        });
        this.getView().setModel(this._oViewModel, "view");

        // Load all lookup dropdowns into a separate JSON model
        this._loadLookups();

        var oRouter = this.getOwnerComponent().getRouter();
        oRouter
          .getRoute("fieldMasterDetail")
          .attachPatternMatched(this._onRouteMatched, this);
      },

      // ── Lookup loader ────────────────────────────────────────────

      _loadLookups: function () {
        var oModel = this.getOwnerComponent().getModel();
        var oLookupsModel = new JSONModel({
          displayTypes: [],
          valueTables: [],
          validationRules: [],
          dataTypes: [],
          mainGroups: [],
        });
        this.getView().setModel(oLookupsModel, "lookups");

        oModel
          .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/displayTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("display_type_id"),
                  text: c.getProperty("display_type_name"),
                };
              }),
            );
          });

        oModel
          .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
          .requestContexts(0, 50)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/dataTypes",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("code"),
                  text:
                    c.getProperty("code") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });

        oModel
          .bindList("/ValueTables", null, [new Sorter("value_table_id")])
          .requestContexts(0, 200)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("value_table_id"),
                text:
                  c.getProperty("value_table_id") +
                  " — " +
                  c.getProperty("description"),
              });
            });
            oLookupsModel.setProperty("/valueTables", aItems);
          });

        oModel
          .bindList("/ValidationRules", null, [new Sorter("validation_id")])
          .requestContexts(0, 200)
          .then(function (aCtx) {
            var aItems = [{ key: "", text: "— None —" }];
            aCtx.forEach(function (c) {
              aItems.push({
                key: c.getProperty("validation_id"),
                text:
                  c.getProperty("validation_id") +
                  " — " +
                  c.getProperty("function_name"),
              });
            });
            oLookupsModel.setProperty("/validationRules", aItems);
          });

        oModel
          .bindList(
            "/FieldGroups",
            null,
            [new Sorter("sequence")],
            [new Filter("parent_group_id_group_id", FilterOperator.EQ, null)],
          )
          .requestContexts(0, 100)
          .then(function (aCtx) {
            oLookupsModel.setProperty(
              "/mainGroups",
              aCtx.map(function (c) {
                return {
                  key: c.getProperty("group_id"),
                  text:
                    c.getProperty("group_id") +
                    " — " +
                    c.getProperty("description"),
                };
              }),
            );
          });
      },

      // ── Route matched ────────────────────────────────────────────

      _onRouteMatched: function (oEvent) {
        var sFieldId = decodeURIComponent(
          oEvent.getParameter("arguments").fieldId,
        );
        // Reset dirty flag on every navigation
        this._oViewModel.setProperty("/isDirty", false);

        if (sFieldId === "NEW") {
          this._createNewField();
        } else {
          this._bindField(sFieldId);
        }
      },

      // ── Binding ──────────────────────────────────────────────────

      _bindField: function (sFieldId) {
        this._oViewModel.setProperty("/isNew", false);
        this._oViewModel.setProperty("/busy", true);

        var sPath = "/FieldMasters('" + sFieldId + "')";
        this.getView().bindObject({
          path: sPath,
          parameters: {
            $expand: [
              "main_group($select=group_id,description)",
              "sub_group($select=group_id,description)",
              "value_table($select=value_table_id,source_table,output_key,output_desc,description)",
              "validation($select=validation_id,function_name,description,input_param_1,input_param_2,input_param_3,error_message)",
            ].join(","),
            $$updateGroupId: "fieldMasterUpdate", // holds changes until submitBatch
          },
          events: {
            dataReceived: function () {
              this._oViewModel.setProperty("/busy", false);
              var oCtx = this.getView().getBindingContext();
              if (!oCtx) {
                MessageToast.show("Field not found");
                this.onNavBack();
                return;
              }
              oCtx.requestObject().then(
                function (oData) {
                  this._updateHeader(oData);
                  this._updateValueTablePreview(oData.value_table);
                  this._updateValidationPreview(oData.validation);
                  this._loadSubGroups(oData.main_group_group_id);
                }.bind(this),
              );
              // Existing field — Field ID should not be changed
              this.byId("inFieldId").setEditable(false);
            }.bind(this),
          },
        });
      },

      // ── New field ────────────────────────────────────────────────

      _createNewField: function () {
        this._oViewModel.setProperty("/isNew", true);
        this._oViewModel.setProperty("/busy", true);

        var oModel = this.getView().getModel();

        Promise.all([
          oModel
            .bindList("/MetaDataTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
          oModel
            .bindList("/MetaDisplayTypes", null, [new Sorter("sequence")])
            .requestContexts(0, 1),
        ])
          .then(
            function (aResults) {
              var sDefaultDataType = aResults[0].length
                ? aResults[0][0].getProperty("code")
                : "";
              var sDefaultDisplayType = aResults[1].length
                ? aResults[1][0].getProperty("display_type_id")
                : "";

              var oContext = oModel.bindList("/FieldMasters").create({
                field_id: "",
                description: "",
                data_type: sDefaultDataType,
                length: 10,
                decimals: null,
                display_type: sDefaultDisplayType,
                active: true,
                source_table: "",
                source_field: "",
              });
              this.getView().setBindingContext(oContext);
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          )
          .catch(
            function () {
              var oContext = oModel.bindList("/FieldMasters").create({
                field_id: "",
                description: "",
                data_type: "",
                length: 10,
                decimals: null,
                display_type: "",
                active: true,
                source_table: "",
                source_field: "",
              });
              this.getView().setBindingContext(oContext);
              this._updateHeader({ field_id: "New Field", description: "" });
              this._oViewModel.setProperty("/busy", false);
            }.bind(this),
          );
      },

      // ── Header helpers ───────────────────────────────────────────

      _updateHeader: function (oData) {
        var sTitle = oData.field_id
          ? oData.field_id +
            (oData.description ? " — " + oData.description : "")
          : "New Field";
        this.byId("pageTitle").setText(sTitle);
        this.byId("attrStatus").setText(oData.active ? "Active" : "Inactive");
        this.byId("attrCreated").setText(oData.createdBy || "—");
        this.byId("attrDate").setText(
          oData.createdAt ? oDateFmt.format(new Date(oData.createdAt)) : "—",
        );
        this.byId("attrModified").setText(
          oData.modifiedAt ? oDateFmt.format(new Date(oData.modifiedAt)) : "—",
        );
      },

      // ── Dirty flag ───────────────────────────────────────────────

      onFieldChange: function () {
        this._oViewModel.setProperty("/isDirty", true);
      },

      // ── Tab 2: Grouping ──────────────────────────────────────────

      onMainGroupChange: function (oEvent) {
        var sGroupId = oEvent.getSource().getSelectedKey();
        this._loadSubGroups(sGroupId);
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
      },

      _loadSubGroups: function (sMainGroupId) {
        if (!sMainGroupId) {
          return;
        }
        var oModel = this.getView().getModel();
        var oSubSel = this.byId("selSubGroup");
        oModel
          .bindList("/FieldGroups", null, null, [
            new Filter(
              "parent_group_id_group_id",
              FilterOperator.EQ,
              sMainGroupId,
            ),
          ])
          .requestContexts()
          .then(function (aContexts) {
            oSubSel.destroyItems();
            aContexts.forEach(function (oCtx) {
              oSubSel.addItem(
                new sap.ui.core.Item({
                  key: oCtx.getProperty("group_id"),
                  text:
                    oCtx.getProperty("group_id") +
                    " — " +
                    oCtx.getProperty("description"),
                }),
              );
            });
          });
      },

      // ── Tab 3: Value Help ────────────────────────────────────────

      onValueTableChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        this._updateValueTablePreview(sKey ? { value_table_id: sKey } : null);
      },

      _updateValueTablePreview: function (oVT) {
        if (!oVT || !oVT.value_table_id) {
          this.byId("vtSource").setText("—");
          this.byId("vtOutputKey").setText("—");
          this.byId("vtOutputDesc").setText("—");
          return;
        }
        if (oVT.source_table) {
          this.byId("vtSource").setText(oVT.source_table);
          this.byId("vtOutputKey").setText(oVT.output_key || "—");
          this.byId("vtOutputDesc").setText(oVT.output_desc || "—");
        } else {
          this.getView()
            .getModel()
            .bindContext("/ValueTables('" + oVT.value_table_id + "')")
            .requestObject()
            .then(
              function (oData) {
                this.byId("vtSource").setText(oData.source_table || "—");
                this.byId("vtOutputKey").setText(oData.output_key || "—");
                this.byId("vtOutputDesc").setText(oData.output_desc || "—");
              }.bind(this),
            );
        }
      },

      // ── Tab 4: Validation ────────────────────────────────────────

      onValidationChange: function (oEvent) {
        var sKey = oEvent.getSource().getSelectedKey();
        this._oViewModel.setProperty("/isDirty", true); // mark dirty
        if (!sKey) {
          this._clearValidationPreview();
          return;
        }
        this.getView()
          .getModel()
          .bindContext("/ValidationRules('" + sKey + "')")
          .requestObject()
          .then(
            function (oData) {
              this._updateValidationPreview(oData);
            }.bind(this),
          );
      },

      _updateValidationPreview: function (oRule) {
        if (!oRule) {
          this._clearValidationPreview();
          return;
        }
        this.byId("valFnName").setText(oRule.function_name || "—");
        this.byId("valDesc").setText(oRule.description || "—");
        this.byId("valParam1").setText(oRule.input_param_1 || "—");
        this.byId("valParam2").setText(oRule.input_param_2 || "—");
        this.byId("valParam3").setText(oRule.input_param_3 || "—");
        this.byId("valErrMsg").setText(oRule.error_message || "—");
      },

      _clearValidationPreview: function () {
        [
          "valFnName",
          "valDesc",
          "valParam1",
          "valParam2",
          "valParam3",
          "valErrMsg",
        ].forEach(
          function (sId) {
            this.byId(sId).setText("—");
          }.bind(this),
        );
      },

      // ── Tab 5: Usage ─────────────────────────────────────────────

      onUsageRowPress: function (oEvent) {
        var oCtx = oEvent.getSource().getBindingContext();
        var sRoleId = oCtx.getProperty("role_role_id");
        if (sRoleId) {
          this.getOwnerComponent()
            .getRouter()
            .navTo("bpRoleDetail", {
              roleId: encodeURIComponent(sRoleId),
            });
        }
      },

      // ── Save ─────────────────────────────────────────────────────

      onSave: function () {
        var sFieldId = this.byId("inFieldId").getValue().trim();
        var sDesc = this.byId("inDescription").getValue().trim();

        if (!sFieldId) {
          MessageBox.error("Field ID is required.");
          return;
        }
        if (!sDesc) {
          MessageBox.error("Description is required.");
          return;
        }

        this._oViewModel.setProperty("/busy", true);

        this.getView()
          .getModel()
          .submitBatch("fieldMasterUpdate")
          .then(
            function () {
              this._oViewModel.setProperty("/busy", false);
              this._oViewModel.setProperty("/isDirty", false);
              MessageToast.show("Field saved successfully.");

              // Refresh header with updated values
              var oCtx = this.getView().getBindingContext();
              if (oCtx) {
                oCtx.requestObject().then(
                  function (oData) {
                    this._updateHeader(oData);
                  }.bind(this),
                );
              }
            }.bind(this),
          )
          .catch(
            function (oErr) {
              this._oViewModel.setProperty("/busy", false);
              MessageBox.error(
                "Save failed: " + (oErr.message || "Unknown error"),
              );
            }.bind(this),
          );
      },

      // ── Cancel ───────────────────────────────────────────────────

      onCancel: function () {
        var fnGoBack = function () {
          this.getView().getModel().resetChanges("fieldMasterUpdate");
          this._oViewModel.setProperty("/isDirty", false);
          this.onNavBack();
        }.bind(this);

        if (this._oViewModel.getProperty("/isDirty")) {
          MessageBox.confirm("Discard unsaved changes?", {
            onClose: function (sAction) {
              if (sAction === MessageBox.Action.OK) {
                fnGoBack();
              }
            },
          });
        } else {
          fnGoBack();
        }
      },

      onCopy: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          MessageToast.show("No field selected to copy.");
          return;
        }

        // Read current field data
        oCtx.requestObject().then(
          function (oData) {
            var oModel = this.getView().getModel();

            // Create a new record pre-populated with copied values
            // Field ID is cleared — user must enter a unique one
            var oNewContext = oModel.bindList("/FieldMasters").create({
              field_id: "",
              description: oData.description + " (Copy)",
              data_type: oData.data_type,
              length: oData.length,
              decimals: oData.decimals,
              display_type: oData.display_type,
              active: false, // new copy starts inactive
              source_table: oData.source_table,
              source_field: oData.source_field,
              main_group_group_id: oData.main_group_group_id,
              sub_group_group_id: oData.sub_group_group_id,
              value_table_value_table_id: oData.value_table_value_table_id,
              validation_validation_id: oData.validation_validation_id,
            });

            // Switch view to the new context
            this.getView().setBindingContext(oNewContext);

            // Reset state flags
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/isDirty", true);

            // Update header to show copy mode
            this._updateHeader({
              field_id: "",
              description: oData.description + " (Copy)",
              active: false,
              createdBy: null,
              createdAt: null,
              modifiedAt: null,
            });

            // Reload sub groups for the copied main group
            this._loadSubGroups(oData.main_group_group_id);

            // Update previews
            this._updateValueTablePreview(oData.value_table);
            this._updateValidationPreview(oData.validation);

            // Switch to General tab so user sees Field ID input first
            this.byId("detailTabs").setSelectedKey("general");

            MessageToast.show(
              "Field copied — enter a new Field ID and press Save.",
            );
          }.bind(this),
        );
      },

      // ── Tab bar ──────────────────────────────────────────────────

      onTabSelect: function (oEvent) {
        var sKey = oEvent.getParameter("key");
        this._oViewModel.setProperty("/selectedTab", sKey);
        if (sKey === "usage") {
          this._loadUsage();
        }
        if (sKey === "changelog") {
          this._loadChangeLog();
        }
      },

      _loadUsage: function () {
        var oCtx = this.getView().getBindingContext();
        if (!oCtx) {
          return;
        }
        var sFieldId = oCtx.getProperty("field_id");
        if (!sFieldId) {
          return;
        }

        var oTable = this.byId("usageTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) {
          return;
        }

        oBinding.filter([
          new Filter("field_field_id", FilterOperator.EQ, sFieldId),
        ]);
        oBinding.attachEventOnce(
          "dataReceived",
          function () {
            var iCount = oBinding.getLength();
            this.byId("usageCount").setText(
              iCount + " role assignment" + (iCount !== 1 ? "s" : ""),
            );
          }.bind(this),
        );
      },

      _loadChangeLog: function () {
        var oCtx = this.getView().getBindingContext();
        var sFieldId = oCtx ? oCtx.getProperty("field_id") : null;
        if (!sFieldId) {
          return;
        }

        var oTable = this.byId("logTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) {
          return;
        }

        oBinding.filter([
          new Filter("entity_name", FilterOperator.EQ, "FieldMaster"),
          new Filter("entity_key", FilterOperator.EQ, sFieldId),
        ]);
        oBinding.resume();
      },

      // ── Navigation ───────────────────────────────────────────────

      onNavBack: function () {
        this.getOwnerComponent().getRouter().navTo("fieldMaster");
      },

      onNavHome: function () {
        this.getOwnerComponent().getRouter().navTo("masterDataTypes");
      },
    });
  },
);
