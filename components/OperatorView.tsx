import React, { useState, useEffect } from "react";
import type { Material, QrData, ActionType } from "../src/types";
import { useWarehouse } from "../hooks/useWarehouse";
import Scanner from "./Scanner";
import ActionModal from "./ActionModal";
import { CameraIcon } from "./Icons";
import { useTranslation } from "../hooks/useTranslation";

const OperatorView: React.FC = () => {
  const [scannedData, setScannedData] = useState<QrData | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [action, setAction] = useState<ActionType | null>(null);

  const { findMaterialById, findMaterialByIdOnline } = useWarehouse();
  const { t } = useTranslation();
  
  const hasLocation = !!material.location;        
  const isFullyConsumed = material ? material.currentQuantity <= 0 : false;


  useEffect(() => {
    if (!scannedData) return;

    (async () => {
      // 🔍 1) Try LOCAL cache first
      let foundMaterial = findMaterialById(scannedData.id);

      // 🔍 2) If not found, try BACKEND lookup
      if (!foundMaterial) {
        foundMaterial = await findMaterialByIdOnline(scannedData.id);
      }

      if (foundMaterial) {
        if (foundMaterial.currentQuantity > 0) {
          setMaterial(foundMaterial);
          setError(null);
        } else {
          setError(
            t("operator.materialConsumedError", {
              materialCode: foundMaterial.materialCode,
              id: foundMaterial.id,
            })
          );
          setMaterial(null);
        }
      } else {
        setError(t("operator.materialNotFoundError"));
        setMaterial(null);
      }
    })();
  }, [scannedData, findMaterialById, findMaterialByIdOnline, t]);

  const handleScanSuccess = (decodedText: string) => {
    try {
      const data = JSON.parse(decodedText) as QrData;
      if (data.id && data.materialCode && data.quantity !== undefined) {
        setScannedData(data);
        setIsScanning(false);
      } else {
        handleScanError(t("operator.scanErrorInvalidFormat"));
      }
    } catch {
      handleScanError(t("operator.scanErrorParseFailed"));
    }
  };

  const handleScanError = (errorMessage: string) => {
    setError(errorMessage);
    setIsScanning(false);
  };

  const reset = () => {
    setScannedData(null);
    setMaterial(null);
    setError(null);
    setIsScanning(false);
    setAction(null);
  };

  const handleActionComplete = () => {
    reset();
  };

  if (isScanning) {
    return (
      <div className="max-w-xl mx-auto">
        <Scanner onScanSuccess={handleScanSuccess} onScanError={handleScanError} />
        <button
          onClick={() => setIsScanning(false)}
          className="mt-4 w-full bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
        >
          {t("operator.cancelScanButton")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-700 mb-4">{t("operator.title")}</h2>

      {!material ? (
        <div>
          <p className="text-gray-600 mb-4">{t("operator.scanPrompt")}</p>
          <button
            onClick={() => {
              reset();
              setIsScanning(true);
            }}
            className="w-full flex justify-center items-center py-3 px-4 rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <CameraIcon className="w-5 h-5 mr-2" />
            {t("operator.startScannerButton")}
          </button>
          {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-md">{error}</p>}
        </div>
      ) : (
        <div>
          <h3 className="text-xl font-semibold text-gray-800">
            {t("operator.materialDetailsTitle")}
          </h3>
          <div className="mt-4 space-y-2 text-gray-700 bg-gray-50 p-4 rounded-md">
            <p>
              <strong>{t("operator.materialCode")}:</strong>{" "}
              <span className="font-mono bg-gray-200 px-2 py-1 rounded">
                {material.materialCode}
              </span>
            </p>
            <p>
              <strong>{t("operator.id")}:</strong>{" "}
              <span className="text-xs font-mono">{material.id}</span>
            </p>
            <p>
              <strong>{t("operator.remainingQuantity")}:</strong>{" "}
              {material.currentQuantity} / {material.initialQuantity}
            </p>
            <p>
              <strong>{t("common.location")}:</strong>{" "}
              {material.location
                ? `${material.location.area}, Position ${material.location.position}`
                : t("common.na")}
            </p>
          </div>

          <div className="mt-6">
            <h4 className="font-semibold mb-3">{t("operator.chooseAction")}:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
				<button
				  onClick={() => setAction("CONSUMPTION")}
				  className="bg-red-500 text-white py-3 px-4 rounded-md hover:bg-red-600"
				  disabled={!hasLocation}
				>
				  {t("operator.fullConsumption")}
				</button>

				<button
				  onClick={() => setAction("PLACEMENT")}
				  className="bg-blue-500 text-white py-3 px-4 rounded-md hover:bg-blue-600"
				  disabled={hasLocation}
				>
				  {t("operator.placement")}
				</button>

				<button
				  onClick={() => setAction("MOVEMENT")}
				  className="bg-yellow-500 text-white py-3 px-4 rounded-md hover:bg-yellow-600"
				  disabled={!hasLocation}
				>
				  {t("operator.movement")}
				</button>

				<button
				  onClick={() => setAction("PARTIAL_CONSUMPTION")}
				  className="bg-green-500 text-white py-3 px-4 rounded-md hover:bg-green-600"
				  disabled={!hasLocation}
				>
				  {t("operator.partialConsumption")}
				</button>
            </div>
            <p className="text-xs text-gray-500 mt-2 text-center">
              {t("operator.actionsDisabledHint")}
            </p>
          </div>
          <button
            onClick={reset}
            className="mt-6 w-full text-indigo-600 hover:text-indigo-800 font-medium"
          >
            {t("operator.scanAnother")}
          </button>
        </div>
      )}

      {action && material && (
        <ActionModal
          actionType={action}
          material={material}
          onClose={() => setAction(null)}
          onComplete={handleActionComplete}
        />
      )}
    </div>
  );
};

export default OperatorView;
